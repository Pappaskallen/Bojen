/**
 * The firm's Fortnox connection and what Bojen has sent there (byggplan step 8). Tokens are
 * encrypted with the firm's data key and only decrypted for a call. Fortnox' refresh token
 * works once, so a refresh holds the connection row locked until the new pair is stored: two
 * workers never spend the same refresh token.
 */
import { ACCESS_TOKEN_SECONDS, REFRESH_MARGIN_MS, REFRESH_TOKEN_DAYS } from "@bojen/core/fortnox";
import type { FortnoxApi, FortnoxTokens } from "@bojen/core";
import { decryptField, encryptField, fieldAad, type Kms } from "@bojen/core/crypto";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { tenantDataKey } from "./access";
import type { Database } from "./client";
import { jobAfterInvoice, jobAfterPayment } from "./pipeline";
import { customer, fortnoxConnection, serviceReport, type StoredInvoice } from "./schema";

type Db = Pick<Database, "select" | "update" | "insert" | "delete" | "execute" | "transaction">;

export interface FortnoxDeps {
  db: Db;
  kms: Kms;
  fortnox: FortnoxApi;
  now: () => Date;
}

const DAY = 86_400_000;

async function sealTokens(
  deps: Pick<FortnoxDeps, "db" | "kms">,
  tenantId: string,
  tokens: FortnoxTokens,
  now: Date,
) {
  const key = await tenantDataKey(deps, tenantId);
  return {
    accessTokenEncrypted: encryptField(
      key,
      tokens.accessToken,
      fieldAad(tenantId, "fortnox_connection.access_token"),
    ),
    refreshTokenEncrypted: encryptField(
      key,
      tokens.refreshToken,
      fieldAad(tenantId, "fortnox_connection.refresh_token"),
    ),
    accessExpiresAt: new Date(now.getTime() + (tokens.expiresIn || ACCESS_TOKEN_SECONDS) * 1000),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_DAYS * DAY),
    scope: tokens.scope,
    needsReconnectAt: null,
    updatedAt: now,
  };
}

/** Stores the tokens from a new connection, replacing an earlier one. */
export async function saveFortnoxConnection(
  deps: Pick<FortnoxDeps, "db" | "kms">,
  input: {
    tenantId: string;
    tokens: FortnoxTokens;
    companyName: string | null;
    connectedBy: string | null;
    now: Date;
  },
): Promise<void> {
  const sealed = await sealTokens(deps, input.tenantId, input.tokens, input.now);
  await deps.db
    .insert(fortnoxConnection)
    .values({
      tenantId: input.tenantId,
      ...sealed,
      companyName: input.companyName,
      connectedBy: input.connectedBy,
      connectedAt: input.now,
    })
    .onConflictDoUpdate({
      target: fortnoxConnection.tenantId,
      set: {
        ...sealed,
        companyName: input.companyName,
        connectedBy: input.connectedBy,
        connectedAt: input.now,
      },
    });
}

export interface FortnoxStatus {
  companyName: string | null;
  connectedAt: Date;
  needsReconnect: boolean;
}

/** What the settings page shows. Never the tokens. */
export async function fortnoxStatus(
  db: Pick<Database, "select">,
  tenantId: string,
): Promise<FortnoxStatus | null> {
  const [row] = await db
    .select({
      companyName: fortnoxConnection.companyName,
      connectedAt: fortnoxConnection.connectedAt,
      needsReconnectAt: fortnoxConnection.needsReconnectAt,
      refreshExpiresAt: fortnoxConnection.refreshExpiresAt,
    })
    .from(fortnoxConnection)
    .where(eq(fortnoxConnection.tenantId, tenantId));
  if (!row) return null;
  return {
    companyName: row.companyName,
    connectedAt: row.connectedAt,
    needsReconnect: row.needsReconnectAt !== null || row.refreshExpiresAt <= new Date(),
  };
}

/** Removes the connection and its tokens. What was sent to Fortnox stays there. */
export async function disconnectFortnox(db: Pick<Database, "delete">, tenantId: string) {
  await db.delete(fortnoxConnection).where(eq(fortnoxConnection.tenantId, tenantId));
}

export class FortnoxReconnectError extends Error {
  constructor() {
    super("Fortnox needs to be connected again");
    this.name = "FortnoxReconnectError";
  }
}

/**
 * A live access token for the firm, refreshed when it is about to run out. Null when the firm
 * has no connection. Throws `FortnoxReconnectError` when Fortnox no longer takes the refresh
 * token; the connection is then marked, and the owner has to connect again.
 */
export async function fortnoxAccessToken(
  deps: FortnoxDeps,
  tenantId: string,
): Promise<string | null> {
  return deps.db
    .transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(fortnoxConnection)
        .where(eq(fortnoxConnection.tenantId, tenantId))
        .for("update");
      if (!row) return null;
      if (row.needsReconnectAt) throw new FortnoxReconnectError();
      const key = await tenantDataKey({ db: tx, kms: deps.kms }, tenantId);
      const now = deps.now();
      if (row.accessExpiresAt.getTime() - REFRESH_MARGIN_MS > now.getTime()) {
        return decryptField(
          key,
          row.accessTokenEncrypted,
          fieldAad(tenantId, "fortnox_connection.access_token"),
        );
      }
      const refreshToken = decryptField(
        key,
        row.refreshTokenEncrypted,
        fieldAad(tenantId, "fortnox_connection.refresh_token"),
      );
      let tokens: FortnoxTokens;
      try {
        tokens = await deps.fortnox.refresh(refreshToken);
      } catch (error) {
        if ((error as { needsReconnect?: boolean }).needsReconnect) {
          await tx
            .update(fortnoxConnection)
            .set({ needsReconnectAt: now, updatedAt: now })
            .where(eq(fortnoxConnection.id, row.id));
          // The mark must stay although the error leaves the transaction.
          return "reconnect" as const;
        }
        throw error;
      }
      await tx
        .update(fortnoxConnection)
        .set(await sealTokens({ db: tx, kms: deps.kms }, tenantId, tokens, now))
        .where(eq(fortnoxConnection.id, row.id));
      return tokens.accessToken;
    })
    .then((token) => {
      if (token === "reconnect") throw new FortnoxReconnectError();
      return token;
    });
}

/** What the invoice is made from: the approved basis, its customer, visit and job. */
export interface FortnoxBasis {
  visitId: string;
  jobId: string;
  customerId: string;
  day: string;
  customer: {
    name: string;
    type: string | null;
    email: string | null;
    phone: string | null;
    billingAddress: string | null;
    fortnoxCustomerNumber: string | null;
  };
  boat: string | null;
  invoice: StoredInvoice;
  fortnoxDocumentNumber: string | null;
}

export async function fortnoxBasis(
  db: Pick<Database, "execute">,
  tenantId: string,
  visitId: string,
): Promise<FortnoxBasis | null> {
  const rows = await db.execute<{
    visit_id: string;
    job_id: string;
    customer_id: string;
    day: string;
    name: string;
    type: string | null;
    email: string | null;
    phone: string | null;
    billing_address: string | null;
    fortnox_customer_number: string | null;
    boat_name: string | null;
    boat_make: string | null;
    boat_model: string | null;
    invoice: StoredInvoice;
    fortnox_document_number: string | null;
  }>(sql`
    select v.id as visit_id, j.id as job_id, c.id as customer_id,
           to_char(lower(v.time_window) at time zone 'Europe/Stockholm', 'YYYY-MM-DD') as day,
           c.name, c.type::text as type, c.email, c.phone, c.billing_address,
           c.fortnox_customer_number,
           b.name as boat_name, b.make as boat_make, b.model as boat_model,
           r.invoice, r.fortnox_document_number
    from service_report r
    join visit v on v.tenant_id = r.tenant_id and v.id = r.visit_id
    join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
    join customer c on c.tenant_id = j.tenant_id and c.id = j.customer_id
    left join boat b on b.tenant_id = j.tenant_id and b.id = j.boat_id
    where r.tenant_id = ${tenantId} and r.visit_id = ${visitId} and r.status = 'approved'`);
  const [r] = [...rows];
  if (!r) return null;
  const model = [r.boat_make, r.boat_model].filter(Boolean).join(" ");
  return {
    visitId: r.visit_id,
    jobId: r.job_id,
    customerId: r.customer_id,
    day: r.day,
    customer: {
      name: r.name,
      type: r.type,
      email: r.email,
      phone: r.phone,
      billingAddress: r.billing_address,
      fortnoxCustomerNumber: r.fortnox_customer_number,
    },
    boat: [r.boat_name, model].filter(Boolean).join(", ") || null,
    invoice: r.invoice,
    fortnoxDocumentNumber: r.fortnox_document_number,
  };
}

export async function saveFortnoxCustomerNumber(
  db: Pick<Database, "update">,
  tenantId: string,
  customerId: string,
  customerNumber: string,
) {
  await db
    .update(customer)
    .set({ fortnoxCustomerNumber: customerNumber })
    .where(and(eq(customer.tenantId, tenantId), eq(customer.id, customerId)));
}

/** The invoice is in Fortnox: its number is kept and the card moves to Fakturerat. */
export async function markFortnoxInvoiced(
  db: Db,
  tenantId: string,
  basis: Pick<FortnoxBasis, "visitId" | "jobId">,
  documentNumber: string,
  at: Date,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(serviceReport)
      .set({ fortnoxDocumentNumber: documentNumber, fortnoxInvoicedAt: at })
      .where(and(eq(serviceReport.tenantId, tenantId), eq(serviceReport.visitId, basis.visitId)));
    await jobAfterInvoice(tx, tenantId, basis.jobId, at);
  });
}

/** Invoices in Fortnox that are not paid yet, made within the last 180 days, for every firm. */
export async function unpaidFortnoxInvoices(
  db: Pick<Database, "execute">,
  now: Date,
): Promise<{ tenantId: string; visitId: string; jobId: string; documentNumber: string }[]> {
  const since = new Date(now.getTime() - 180 * DAY);
  const rows = await db.execute<{
    tenant_id: string;
    visit_id: string;
    job_id: string;
    fortnox_document_number: string;
  }>(sql`
    select r.tenant_id, r.visit_id, v.job_id, r.fortnox_document_number
    from service_report r
    join visit v on v.tenant_id = r.tenant_id and v.id = r.visit_id
    join fortnox_connection f on f.tenant_id = r.tenant_id and f.needs_reconnect_at is null
    where r.fortnox_document_number is not null and r.fortnox_paid_at is null
      and r.fortnox_invoiced_at >= ${since.toISOString()}::timestamptz
    order by r.tenant_id, r.fortnox_invoiced_at`);
  return [...rows].map((r) => ({
    tenantId: r.tenant_id,
    visitId: r.visit_id,
    jobId: r.job_id,
    documentNumber: r.fortnox_document_number,
  }));
}

/** Fortnox says it is paid: the date is kept and the card moves to Betalt. */
export async function markFortnoxPaid(
  db: Db,
  tenantId: string,
  invoice: { visitId: string; jobId: string },
  at: Date,
) {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(serviceReport)
      .set({ fortnoxPaidAt: at })
      .where(
        and(
          eq(serviceReport.tenantId, tenantId),
          eq(serviceReport.visitId, invoice.visitId),
          isNotNull(serviceReport.fortnoxDocumentNumber),
          isNull(serviceReport.fortnoxPaidAt),
        ),
      )
      .returning({ id: serviceReport.id });
    if (updated.length) await jobAfterPayment(tx, tenantId, invoice.jobId, at);
  });
}

/** Whether the firm has a working connection, for deciding to queue an invoice at all. */
export async function hasFortnox(db: Pick<Database, "select">, tenantId: string, now: Date) {
  const [row] = await db
    .select({ id: fortnoxConnection.id })
    .from(fortnoxConnection)
    .where(
      and(
        eq(fortnoxConnection.tenantId, tenantId),
        isNull(fortnoxConnection.needsReconnectAt),
        gte(fortnoxConnection.refreshExpiresAt, now),
      ),
    );
  return row !== undefined;
}

/** The firm's article numbers and due days for the invoices (`tenant.settings.fortnox`). */
export async function saveFortnoxSettings(
  db: Pick<Database, "execute">,
  tenantId: string,
  settings: { articles: Record<string, string>; dueDays: number },
) {
  await db.execute(sql`
    update tenant set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{fortnox}',
      ${JSON.stringify(settings)}::jsonb), updated_at = now()
    where id = ${tenantId}`);
}
