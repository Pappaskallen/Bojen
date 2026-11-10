import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { boat } from "./boat";
import { customer } from "./customer";
import { messageChannel, messageDirection, messageIntent, messageStatus } from "./enums";
import { tenant } from "./tenant";
import { visit } from "./visit";

/**
 * Everything sent or received: sms, e-mail and push. The body is cleared after 24 months
 * and only metadata is kept (spec 10.3). Access codes are never sent, so never stored here.
 */
export const message = pgTable(
  "message",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    channel: messageChannel("channel").notNull(),
    direction: messageDirection("direction").notNull(),
    /** Template key, for example `f2_booking_confirmation`. Empty for free text and inbound. */
    template: text("template"),
    customerId: uuid("customer_id"),
    boatId: uuid("boat_id"),
    visitId: uuid("visit_id"),
    /** Phone number in E.164, e-mail address or push token, depending on the channel. */
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    body: text("body"),
    status: messageStatus("status").notNull(),
    /** Interpreted intent of an inbound reply. */
    intent: messageIntent("intent"),
    /** The provider's id, used to match delivery reports. */
    externalId: text("external_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "message_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    foreignKey({
      name: "message_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    foreignKey({
      name: "message_visit_fk",
      columns: [t.tenantId, t.visitId],
      foreignColumns: [visit.tenantId, visit.id],
    }),
    unique("message_tenant_id_id_key").on(t.tenantId, t.id),
    // The customer's conversation, newest last (byggplan 1.4).
    index("message_tenant_id_customer_id_created_at_idx").on(t.tenantId, t.customerId, t.createdAt),
    index("message_visit_id_idx").on(t.tenantId, t.visitId),
    index("message_external_id_idx").on(t.externalId),
    tenantIsolationPolicy(),
  ],
);
