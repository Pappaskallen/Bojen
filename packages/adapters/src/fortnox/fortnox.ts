import { FORTNOX_API_URL, FORTNOX_TOKEN_URL } from "@bojen/core/fortnox";
import type { FortnoxApi, FortnoxInvoiceState, FortnoxTokens } from "@bojen/core";

/**
 * Fortnox over HTTP (step 8). The token endpoint takes the app's client id and secret with
 * Basic auth; the API takes the firm's access token as Bearer. Limits: 25 calls per 5 s per
 * firm; over it Fortnox answers 429, which is thrown as `FortnoxError` so the worker's job is
 * tried again later. Field names from Fortnox' OpenAPI description (read 2026-11-23).
 */
export interface FortnoxOptions {
  clientId: string;
  clientSecret: string;
  /** `https://api.fortnox.se/3`; tests point it at a fake server. */
  apiUrl?: string;
  /** `https://apps.fortnox.se/oauth-v1/token`. */
  tokenUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class FortnoxError extends Error {
  constructor(
    readonly status: number,
    /** Fortnox' own error code (`ErrorInformation.Code`), when there is one. */
    readonly code: number | null,
    detail: string,
  ) {
    super(
      `Fortnox answered ${String(status)}${code ? ` (${String(code)})` : ""}: ${detail.slice(0, 200)}`,
    );
    this.name = "FortnoxError";
  }

  /** The refresh token is spent or revoked: the firm has to connect again. */
  get needsReconnect(): boolean {
    return this.status === 400 || this.status === 401;
  }
}

interface InvoiceJson {
  DocumentNumber?: string | number;
  Balance?: number | null;
  Cancelled?: boolean;
  Total?: number | null;
}

function invoiceState(json: InvoiceJson | undefined): FortnoxInvoiceState {
  if (!json?.DocumentNumber) throw new FortnoxError(200, null, "no DocumentNumber in answer");
  return {
    documentNumber: String(json.DocumentNumber),
    balance: typeof json.Balance === "number" ? json.Balance : null,
    cancelled: json.Cancelled === true,
    total: typeof json.Total === "number" ? json.Total : null,
  };
}

export function createFortnoxApi(options: FortnoxOptions): FortnoxApi {
  const send = options.fetch ?? globalThis.fetch;
  const api = (options.apiUrl ?? FORTNOX_API_URL).replace(/\/+$/, "");
  const tokenUrl = options.tokenUrl ?? FORTNOX_TOKEN_URL;
  const basic = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;

  async function fail(response: Response): Promise<never> {
    const text = await response.text();
    let code: number | null = null;
    let message = text;
    try {
      const info = (JSON.parse(text) as { ErrorInformation?: { Code?: number; Message?: string } })
        .ErrorInformation;
      code = typeof info?.Code === "number" ? info.Code : null;
      message = info?.Message ?? text;
    } catch {
      // Not JSON; the text is the detail.
    }
    throw new FortnoxError(response.status, code, message);
  }

  async function token(form: Record<string, string>): Promise<FortnoxTokens> {
    const response = await send(tokenUrl, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return fail(response);
    const json = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!json.access_token || !json.refresh_token)
      throw new FortnoxError(response.status, null, "no tokens in answer");
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in ?? 3600,
      scope: json.scope ?? "",
    };
  }

  async function call<T>(
    accessToken: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await send(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return fail(response);
    return (await response.json()) as T;
  }

  return {
    exchangeCode: ({ code, redirectUri, verifier }) =>
      token({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
    async companyName(accessToken) {
      const json = await call<{ CompanyInformation?: { CompanyName?: string } }>(
        accessToken,
        "GET",
        "/companyinformation",
      );
      return json.CompanyInformation?.CompanyName ?? null;
    },
    async createCustomer(accessToken, customer) {
      const json = await call<{ Customer?: { CustomerNumber?: string | number } }>(
        accessToken,
        "POST",
        "/customers",
        { Customer: customer },
      );
      const number = json.Customer?.CustomerNumber;
      if (number === undefined || number === "")
        throw new FortnoxError(201, null, "no CustomerNumber in answer");
      return String(number);
    },
    async updateCustomer(accessToken, customerNumber, customer) {
      await call(accessToken, "PUT", `/customers/${encodeURIComponent(customerNumber)}`, {
        Customer: customer,
      });
    },
    async findInvoice(accessToken, reference) {
      const json = await call<{ Invoices?: InvoiceJson[] }>(
        accessToken,
        "GET",
        `/invoices?externalinvoicereference1=${encodeURIComponent(reference)}`,
      );
      const found = (json.Invoices ?? []).filter((i) => !i.Cancelled);
      return found[0] ? invoiceState(found[0]) : null;
    },
    async createInvoice(accessToken, invoice) {
      const json = await call<{ Invoice?: InvoiceJson }>(accessToken, "POST", "/invoices", {
        Invoice: invoice,
      });
      return invoiceState(json.Invoice);
    },
    async getInvoice(accessToken, documentNumber) {
      const json = await call<{ Invoice?: InvoiceJson }>(
        accessToken,
        "GET",
        `/invoices/${encodeURIComponent(documentNumber)}`,
      );
      return invoiceState(json.Invoice);
    },
  };
}

/**
 * Fortnox from the environment, or null when the app is not registered yet:
 * `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET`, and `FORTNOX_API_URL` / `FORTNOX_TOKEN_URL`
 * for a fake server in the end-to-end tests.
 */
export function fortnoxFromEnv(env: NodeJS.ProcessEnv = process.env): FortnoxApi | null {
  const clientId = env.FORTNOX_CLIENT_ID;
  const clientSecret = env.FORTNOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return createFortnoxApi({
    clientId,
    clientSecret,
    ...(env.FORTNOX_API_URL ? { apiUrl: env.FORTNOX_API_URL } : {}),
    ...(env.FORTNOX_TOKEN_URL ? { tokenUrl: env.FORTNOX_TOKEN_URL } : {}),
  });
}
