import { describe, expect, it, vi } from "vitest";
import { createFakeFortnox } from "./fake";
import { FortnoxError, createFortnoxApi } from "./fortnox";

type Call = { url: string; init: RequestInit };

function api(responses: Response[]) {
  const calls: Call[] = [];
  const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(responses.shift() ?? new Response("{}", { status: 500 }));
  });
  return {
    calls,
    fortnox: createFortnoxApi({
      clientId: "cid",
      clientSecret: "secret",
      fetch: fetch as unknown as typeof globalThis.fetch,
    }),
  };
}

describe("Fortnox over HTTP", () => {
  it("exchanges the code with Basic auth and the PKCE verifier", async () => {
    const { calls, fortnox } = api([
      Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "invoice" }),
    ]);
    const tokens = await fortnox.exchangeCode({
      code: "c",
      redirectUri: "https://bojen.test/cb",
      verifier: "v",
    });
    expect(tokens).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 3600,
      scope: "invoice",
    });
    expect(calls[0]?.url).toBe("https://apps.fortnox.se/oauth-v1/token");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)))).toEqual({
      grant_type: "authorization_code",
      code: "c",
      redirect_uri: "https://bojen.test/cb",
      code_verifier: "v",
    });
  });

  it("sends the invoice wrapped, with the Bearer token, and reads the answer", async () => {
    const { calls, fortnox } = api([
      Response.json(
        { Invoice: { DocumentNumber: 1042, Balance: 2350, Cancelled: false, Total: 2350 } },
        { status: 201 },
      ),
    ]);
    const state = await fortnox.createInvoice("tok", { CustomerNumber: "17" });
    expect(state).toEqual({ documentNumber: "1042", balance: 2350, cancelled: false, total: 2350 });
    expect(calls[0]?.url).toBe("https://api.fortnox.se/3/invoices");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ Invoice: { CustomerNumber: "17" } });
  });

  it("finds an earlier invoice by Bojen's reference and skips cancelled ones", async () => {
    const { calls, fortnox } = api([
      Response.json({
        Invoices: [
          { DocumentNumber: "5", Cancelled: true, Balance: 0 },
          { DocumentNumber: "6", Cancelled: false, Balance: 100 },
        ],
      }),
    ]);
    expect(await fortnox.findInvoice("tok", "bojen:v-1")).toMatchObject({ documentNumber: "6" });
    expect(calls[0]?.url).toBe(
      "https://api.fortnox.se/3/invoices?externalinvoicereference1=bojen%3Av-1",
    );
  });

  it("throws Fortnox' error code, and 429 too, so the job is tried again", async () => {
    const { fortnox } = api([
      Response.json(
        { ErrorInformation: { Error: 1, Message: "Kunde inte hitta kund", Code: 2000433 } },
        { status: 404 },
      ),
      new Response("Too Many Requests", { status: 429 }),
    ]);
    const error = await fortnox.updateCustomer("tok", "9", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FortnoxError);
    expect(error).toMatchObject({ status: 404, code: 2000433 });
    await expect(fortnox.getInvoice("tok", "1")).rejects.toMatchObject({ status: 429 });
  });
});

describe("the fake Fortnox", () => {
  it("rotates refresh tokens like Fortnox: each works once", async () => {
    const fake = createFakeFortnox();
    const first = await fake.exchangeCode({ code: "good-code", redirectUri: "x", verifier: "v" });
    const second = await fake.refresh(first.refreshToken);
    await expect(fake.refresh(first.refreshToken)).rejects.toMatchObject({ needsReconnect: true });
    expect(await fake.companyName(second.accessToken)).toBe("Testfirman AB");
  });
});
