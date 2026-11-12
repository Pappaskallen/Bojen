import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    /** E-mail only: the subject and the HTML part; `body` holds the plain text. */
    subject: text("subject"),
    bodyHtml: text("body_html"),
    status: messageStatus("status").notNull(),
    /** Interpreted intent of an inbound reply. */
    intent: messageIntent("intent"),
    /** How sure the interpretation is, 0–1: 1 from the rules, the model's own otherwise. */
    intentConfidence: real("intent_confidence"),
    /** The score 1–5 of a reply to the satisfaction question (F9). */
    rating: smallint("rating"),
    /** The question an inbound reply answers (step 3.2). */
    replyToId: uuid("reply_to_id"),
    /** The provider's id, used to match delivery reports. */
    externalId: text("external_id"),
    error: text("error"),
    /** Not before this time: the quiet hours 21–08 move notices to 08:00 (step 3.1). */
    sendAfter: timestamp("send_after", { withTimezone: true }),
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
    foreignKey({
      name: "message_reply_to_fk",
      columns: [t.tenantId, t.replyToId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check("message_rating_range", sql`${t.rating} between 1 and 5`),
    check(
      "message_intent_confidence_range",
      sql`${t.intentConfidence} >= 0 and ${t.intentConfidence} <= 1`,
    ),
    // The questions sent to a number, newest first, for linking a reply (step 3.2).
    index("message_tenant_id_to_address_created_at_idx").on(t.tenantId, t.toAddress, t.createdAt),
    index("message_reply_to_id_idx").on(t.tenantId, t.replyToId),
    // The customer's conversation, newest last (byggplan 1.4).
    index("message_tenant_id_customer_id_created_at_idx").on(t.tenantId, t.customerId, t.createdAt),
    index("message_visit_id_idx").on(t.tenantId, t.visitId),
    index("message_external_id_idx").on(t.externalId),
    tenantIsolationPolicy(),
  ],
);
