/**
 * The approved invoice bases of a month, for the CSV export (spec 12.1, until Fortnox in
 * step 8). A basis belongs to the month its visit was on, in Stockholm. Marking them
 * invoiced moves each job from Utfört to Fakturerat, as an invoice from Fortnox will.
 */
import { monthRange, stockholmInstant, type InvoiceExportRow } from "@bojen/core";
import type { StoredInvoice } from "./schema";
import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { jobAfterInvoice } from "./pipeline";

type Db = Pick<Database, "select" | "update" | "insert" | "execute">;

type Row = {
  visit_id: string;
  job_id: string;
  day: string;
  customer: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  boat_name: string | null;
  boat_make: string | null;
  boat_model: string | null;
  service: string | null;
  invoice: StoredInvoice;
};

async function approvedInMonth(db: Db, tenantId: string, month: string): Promise<Row[] | null> {
  const range = monthRange(month);
  if (!range) return null;
  const from = stockholmInstant(range.first, "00:00");
  const to = stockholmInstant(range.next, "00:00");
  const rows = await db.execute<Row>(sql`
    select v.id as visit_id, j.id as job_id,
           to_char(lower(v.time_window) at time zone 'Europe/Stockholm', 'YYYY-MM-DD') as day,
           c.name as customer, c.email, c.phone, c.billing_address,
           b.name as boat_name, b.make as boat_make, b.model as boat_model,
           st.name as service, r.invoice
    from service_report r
    join visit v on v.tenant_id = r.tenant_id and v.id = r.visit_id and v.deleted_at is null
    join job j on j.tenant_id = v.tenant_id and j.id = v.job_id and j.deleted_at is null
    join customer c on c.tenant_id = j.tenant_id and c.id = j.customer_id
    left join boat b on b.tenant_id = j.tenant_id and b.id = j.boat_id
    left join service_type st on st.tenant_id = j.tenant_id and st.id = j.service_type_id
    where r.tenant_id = ${tenantId} and r.status = 'approved'
      and lower(v.time_window) >= ${from.toISOString()}::timestamptz
      and lower(v.time_window) < ${to.toISOString()}::timestamptz
    order by lower(v.time_window), v.id`);
  return [...rows];
}

function boatLabel(r: Row): string | null {
  const model = [r.boat_make, r.boat_model].filter(Boolean).join(" ");
  return [r.boat_name, model].filter(Boolean).join(", ") || null;
}

/** The month's approved bases as export rows, or null for a month that is not `YYYY-MM`. */
export async function invoiceExportRows(
  db: Db,
  tenantId: string,
  month: string,
): Promise<InvoiceExportRow[] | null> {
  const rows = await approvedInMonth(db, tenantId, month);
  return (
    rows?.map((r) => ({
      visitId: r.visit_id,
      day: r.day,
      customer: r.customer,
      email: r.email,
      phone: r.phone,
      billingAddress: r.billing_address,
      boat: boatLabel(r),
      service: r.service,
      lines: r.invoice.lines,
      netOre: r.invoice.netOre,
      vatOre: r.invoice.vatOre,
      grossOre: r.invoice.grossOre,
    })) ?? null
  );
}

/**
 * Moves the jobs of the month's approved bases to Fakturerat; jobs already past Utfört stay.
 * Returns how many moved, or null for a month that is not `YYYY-MM`.
 */
export async function markMonthInvoiced(
  db: Db,
  tenantId: string,
  month: string,
  at: Date,
): Promise<number | null> {
  const rows = await approvedInMonth(db, tenantId, month);
  if (!rows) return null;
  let moved = 0;
  for (const jobId of new Set(rows.map((r) => r.job_id))) {
    if (await jobAfterInvoice(db, tenantId, jobId, at)) moved++;
  }
  return moved;
}
