import {
  fortnoxCustomer,
  fortnoxInvoice,
  fortnoxSettings,
  invoicePayment,
} from "@bojen/core/fortnox";
import {
  FortnoxReconnectError,
  fortnoxAccessToken,
  fortnoxBasis,
  hasFortnox,
  markFortnoxInvoiced,
  markFortnoxPaid,
  saveFortnoxCustomerNumber,
  scheduleJob,
  tenant,
  unpaidFortnoxInvoices,
  type FortnoxDeps,
} from "@bojen/db";
import { eq } from "drizzle-orm";

/** Makes the invoice in Fortnox for one approved report: { tenantId, visitId }. */
export const FORTNOX_INVOICE_TASK = "fortnox_invoice";
/** Checks the unpaid invoices of every firm, hourly from the crontab in index.ts. */
export const FORTNOX_PAYMENTS_TASK = "fortnox_payments";
export const FORTNOX_CRONTAB = `5 * * * * ${FORTNOX_PAYMENTS_TASK}`;

/** After `report.approved`: queues the invoice if the firm has Fortnox connected. */
export async function queueFortnoxInvoice(
  deps: Pick<FortnoxDeps, "db" | "now">,
  tenantId: string,
  visitId: string,
): Promise<boolean> {
  if (!(await hasFortnox(deps.db, tenantId, deps.now()))) return false;
  await scheduleJob(
    deps.db,
    FORTNOX_INVOICE_TASK,
    { tenantId, visitId },
    deps.now(),
    `fortnox:${visitId}`,
  );
  return true;
}

export type FortnoxInvoiceOutcome =
  "invoiced" | "already" | "not_connected" | "reconnect" | "no_basis";

/**
 * The approved basis becomes an invoice in Fortnox (step 8). The customer is made in Fortnox
 * the first time and updated after that. The visit is the invoice's reference: a retry after a
 * timeout finds the invoice already made instead of making a second.
 */
export async function sendFortnoxInvoice(
  deps: FortnoxDeps,
  tenantId: string,
  visitId: string,
): Promise<FortnoxInvoiceOutcome> {
  const basis = await fortnoxBasis(deps.db, tenantId, visitId);
  if (!basis) return "no_basis";
  if (basis.fortnoxDocumentNumber) return "already";
  let token: string | null;
  try {
    token = await fortnoxAccessToken(deps, tenantId);
  } catch (error) {
    if (error instanceof FortnoxReconnectError) return "reconnect";
    throw error;
  }
  if (!token) return "not_connected";

  const reference = `bojen:${visitId}`;
  const found = await deps.fortnox.findInvoice(token, reference);
  if (found) {
    await markFortnoxInvoiced(deps.db, tenantId, basis, found.documentNumber, deps.now());
    return "invoiced";
  }

  const customer = fortnoxCustomer(basis.customer);
  let customerNumber = basis.customer.fortnoxCustomerNumber;
  if (customerNumber) {
    try {
      await deps.fortnox.updateCustomer(token, customerNumber, { ...customer });
    } catch (error) {
      // Removed in Fortnox since: made anew below.
      if ((error as { status?: number }).status !== 404) throw error;
      customerNumber = null;
    }
  }
  if (!customerNumber) {
    customerNumber = await deps.fortnox.createCustomer(token, { ...customer });
    await saveFortnoxCustomerNumber(deps.db, tenantId, basis.customerId, customerNumber);
  }

  const [firm] = await deps.db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const invoice = fortnoxInvoice({
    customerNumber,
    visitId,
    day: basis.day,
    lines: basis.invoice.lines,
    settings: fortnoxSettings(firm?.settings),
    boat: basis.boat,
  });
  const made = await deps.fortnox.createInvoice(token, { ...invoice });
  await markFortnoxInvoiced(deps.db, tenantId, basis, made.documentNumber, deps.now());
  return "invoiced";
}

/**
 * The unpaid invoices of every connected firm, one firm at a time. A paid one moves its card
 * to Betalt. A firm whose connection has run out is skipped until the owner connects again.
 */
export async function checkFortnoxPayments(
  deps: FortnoxDeps,
): Promise<{ checked: number; paid: number; skipped: number }> {
  const open = await unpaidFortnoxInvoices(deps.db, deps.now());
  const byFirm = new Map<string, typeof open>();
  for (const invoice of open) {
    byFirm.set(invoice.tenantId, [...(byFirm.get(invoice.tenantId) ?? []), invoice]);
  }
  let checked = 0;
  let paid = 0;
  let skipped = 0;
  for (const [tenantId, invoices] of byFirm) {
    let token: string | null;
    try {
      token = await fortnoxAccessToken(deps, tenantId);
    } catch (error) {
      if (!(error instanceof FortnoxReconnectError)) throw error;
      token = null;
    }
    if (!token) {
      skipped += invoices.length;
      continue;
    }
    for (const invoice of invoices) {
      const state = await deps.fortnox.getInvoice(token, invoice.documentNumber);
      checked++;
      if (invoicePayment({ Balance: state.balance, Cancelled: state.cancelled }) === "paid") {
        await markFortnoxPaid(deps.db, tenantId, invoice, deps.now());
        paid++;
      }
    }
  }
  return { checked, paid, skipped };
}
