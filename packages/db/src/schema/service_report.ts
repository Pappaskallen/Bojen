import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";
import { appUser } from "./user";
import { visit } from "./visit";

/** A recommendation in the report, as the customer reads it (spec P6). */
export interface StoredRecommendation {
  text: string;
  priority: "now" | "next_season" | "monitor";
}

/** A line of the invoice basis as it was approved, for Fortnox in step 8. */
export interface StoredInvoiceLine {
  type: "labour" | "callout" | "emergency" | "discount" | "part";
  description: string;
  quantity: number;
  unitPriceOre: number;
  amountOre: number;
}

/** The invoice basis as approved: the lines and the sums, in öre. */
export interface StoredInvoice {
  lines: StoredInvoiceLine[];
  netOre: number;
  vatOre: number;
  grossOre: number;
}

/**
 * The service report of a visit (byggplan step 5.5d, spec 6.1 ServiceReport). It is made when
 * the visit is done (`drafting`), filled by the draft from Claude (`draft`) and approved by
 * the mechanic (`approved`), which sends it to the customer (F7). After the approval it no
 * longer changes.
 */
export const serviceReport = pgTable(
  "service_report",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    status: text("status").notNull().default("drafting"),
    /** The work done, one point per line. */
    workDone: text("work_done"),
    recommendations: jsonb("recommendations").$type<StoredRecommendation[]>().notNull().default([]),
    nextService: text("next_service"),
    /** Who wrote the draft: the model id, `fake` in tests, or null before a draft. */
    draftedBy: text("drafted_by"),
    draftedAt: timestamp("drafted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    invoice: jsonb("invoice").$type<StoredInvoice>(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "service_report_visit_fk",
      columns: [t.tenantId, t.visitId],
      foreignColumns: [visit.tenantId, visit.id],
    }),
    foreignKey({
      name: "service_report_approved_by_fk",
      columns: [t.tenantId, t.approvedBy],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    check("service_report_status", sql`${t.status} in ('drafting', 'draft', 'approved')`),
    check(
      "service_report_approved",
      sql`(${t.status} = 'approved') = (${t.approvedAt} is not null and ${t.invoice} is not null)`,
    ),
    uniqueIndex("service_report_visit_key").on(t.tenantId, t.visitId),
    tenantIsolationPolicy(),
  ],
);
