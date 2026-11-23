import type { FortnoxApi, FortnoxInvoiceState, FortnoxTokens } from "@bojen/core";
import { FortnoxError } from "./fortnox";

/**
 * Fortnox in memory, for tests. Tokens rotate as at Fortnox: a refresh token works once.
 * `pay` marks an invoice paid, as the firm's customer would.
 */
export interface FakeFortnox extends FortnoxApi {
  customers: Map<string, Record<string, unknown>>;
  invoices: Map<string, { invoice: Record<string, unknown>; state: FortnoxInvoiceState }>;
  calls: string[];
  pay(documentNumber: string): void;
  /** The next call throws this, once. */
  failNext(error: FortnoxError): void;
}

export function createFakeFortnox(input: { company?: string } = {}): FakeFortnox {
  const live = new Set<string>();
  const refreshTokens = new Set<string>();
  const customers = new Map<string, Record<string, unknown>>();
  const invoices = new Map<
    string,
    { invoice: Record<string, unknown>; state: FortnoxInvoiceState }
  >();
  const calls: string[] = [];
  let n = 0;
  let pending: FortnoxError | null = null;

  const issue = (): FortnoxTokens => {
    n += 1;
    const tokens = {
      accessToken: `access-${String(n)}`,
      refreshToken: `refresh-${String(n)}`,
      expiresIn: 3600,
      scope: "customer article invoice payment companyinformation",
    };
    live.add(tokens.accessToken);
    refreshTokens.add(tokens.refreshToken);
    return tokens;
  };
  /** Records the call; the error it should fail with, if any. */
  const step = (name: string, accessToken?: string): FortnoxError | null => {
    calls.push(name);
    if (pending) {
      const error = pending;
      pending = null;
      return error;
    }
    if (accessToken !== undefined && !live.has(accessToken))
      return new FortnoxError(401, 2000310, "Ogiltig inloggning");
    return null;
  };

  return {
    customers,
    invoices,
    calls,
    pay(documentNumber) {
      const found = invoices.get(documentNumber);
      if (found) found.state = { ...found.state, balance: 0 };
    },
    failNext(error) {
      pending = error;
    },
    exchangeCode({ code }) {
      const failed = step("exchangeCode");
      if (failed) return Promise.reject(failed);
      if (code !== "good-code") return Promise.reject(new FortnoxError(400, null, "invalid_grant"));
      return Promise.resolve(issue());
    },
    refresh(refreshToken) {
      const failed = step("refresh");
      if (failed) return Promise.reject(failed);
      if (!refreshTokens.delete(refreshToken))
        return Promise.reject(new FortnoxError(400, null, "invalid_grant"));
      return Promise.resolve(issue());
    },
    companyName(accessToken) {
      const failed = step("companyName", accessToken);
      if (failed) return Promise.reject(failed);
      return Promise.resolve(input.company ?? "Testfirman AB");
    },
    createCustomer(accessToken, customer) {
      const failed = step("createCustomer", accessToken);
      if (failed) return Promise.reject(failed);
      const number = String(customers.size + 1);
      customers.set(number, { ...customer, CustomerNumber: number });
      return Promise.resolve(number);
    },
    updateCustomer(accessToken, customerNumber, customer) {
      const failed = step("updateCustomer", accessToken);
      if (failed) return Promise.reject(failed);
      if (!customers.has(customerNumber))
        return Promise.reject(new FortnoxError(404, 2000433, "Kunde inte hitta kund"));
      customers.set(customerNumber, { ...customer, CustomerNumber: customerNumber });
      return Promise.resolve();
    },
    findInvoice(accessToken, reference) {
      const failed = step("findInvoice", accessToken);
      if (failed) return Promise.reject(failed);
      for (const { invoice, state } of invoices.values())
        if (invoice.ExternalInvoiceReference1 === reference && !state.cancelled)
          return Promise.resolve(state);
      return Promise.resolve(null);
    },
    createInvoice(accessToken, invoice) {
      const failed = step("createInvoice", accessToken);
      if (failed) return Promise.reject(failed);
      const rows = (invoice.InvoiceRows ?? []) as { Price: number; DeliveredQuantity: string }[];
      const net = rows.reduce((sum, r) => sum + r.Price * Number(r.DeliveredQuantity), 0);
      const total = Math.round(net * 1.25 * 100) / 100;
      const state = {
        documentNumber: String(invoices.size + 1),
        balance: total,
        cancelled: false,
        total,
      };
      invoices.set(state.documentNumber, { invoice, state });
      return Promise.resolve(state);
    },
    getInvoice(accessToken, documentNumber) {
      const failed = step("getInvoice", accessToken);
      if (failed) return Promise.reject(failed);
      const found = invoices.get(documentNumber);
      if (!found) return Promise.reject(new FortnoxError(404, null, "Kunde inte hitta faktura"));
      return Promise.resolve(found.state);
    },
  };
}
