import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";
import { visit } from "./visit";

/** The satisfaction question after a visit (CSAT 1–5, KPI 17). */
export const survey = pgTable(
  "survey",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    score: smallint("score"),
    comment: text("comment"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    reviewLinkClickedAt: timestamp("review_link_clicked_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "survey_visit_fk",
      columns: [t.tenantId, t.visitId],
      foreignColumns: [visit.tenantId, visit.id],
    }),
    uniqueIndex("survey_visit_id_key")
      .on(t.visitId)
      .where(sql`${t.deletedAt} is null`),
    check("survey_score_range", sql`${t.score} between 1 and 5`),
    tenantIsolationPolicy(),
  ],
);
