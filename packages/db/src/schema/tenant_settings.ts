import { foreignKey, pgTable, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { approvalMode, customerKind } from "./enums";
import { serviceType } from "./service_type";
import { tenant } from "./tenant";

/**
 * How the firm confirms bookings that customers make themselves (byggplan step 2.6, W5),
 * per service and customer type. An empty service or customer type means "all". The most
 * specific rule wins (packages/core `needsApproval`); without rules, new customers are
 * approved by hand and existing customers are booked at once.
 */
export const approvalRule = pgTable(
  "approval_rule",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    serviceTypeId: uuid("service_type_id"),
    customerKind: customerKind("customer_kind"),
    mode: approvalMode("mode").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "approval_rule_service_type_fk",
      columns: [t.tenantId, t.serviceTypeId],
      foreignColumns: [serviceType.tenantId, serviceType.id],
    }),
    unique("approval_rule_scope_key")
      .on(t.tenantId, t.serviceTypeId, t.customerKind)
      .nullsNotDistinct(),
    tenantIsolationPolicy(),
  ],
);
