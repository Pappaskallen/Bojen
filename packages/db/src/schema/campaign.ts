import {
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { boat } from "./boat";
import { customer } from "./customer";
import { campaignRecipientStatus, campaignStatus } from "./enums";
import { tenant } from "./tenant";
import { visit } from "./visit";

/** A campaign, for example the spring campaign in January. */
export const campaign = pgTable(
  "campaign",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    /** Rules that pick the recipients, evaluated in packages/core (step 5.6). */
    segmentRules: jsonb("segment_rules").notNull().default({}),
    /** Template keys per channel and step, for example first message and reminder. */
    templates: jsonb("templates").notNull().default({}),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
    /** How the suggested visit is chosen, for example "same week as last year". */
    suggestedVisitRule: jsonb("suggested_visit_rule"),
    status: campaignStatus("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("campaign_tenant_id_id_key").on(t.tenantId, t.id),
    tenantIsolationPolicy(),
  ],
);

/** One recipient of a campaign: a customer and, usually, one of their boats. */
export const campaignRecipient = pgTable(
  "campaign_recipient",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    boatId: uuid("boat_id"),
    /** The reserved visit offered to the recipient. Released after 14 days without reply. */
    suggestedVisitId: uuid("suggested_visit_id"),
    status: campaignRecipientStatus("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "campaign_recipient_campaign_fk",
      columns: [t.tenantId, t.campaignId],
      foreignColumns: [campaign.tenantId, campaign.id],
    }),
    foreignKey({
      name: "campaign_recipient_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    foreignKey({
      name: "campaign_recipient_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    foreignKey({
      name: "campaign_recipient_visit_fk",
      columns: [t.tenantId, t.suggestedVisitId],
      foreignColumns: [visit.tenantId, visit.id],
    }),
    // A boat gets each campaign once; NULLS NOT DISTINCT also covers recipients without a boat.
    unique("campaign_recipient_once_key")
      .on(t.campaignId, t.customerId, t.boatId)
      .nullsNotDistinct(),
    index("campaign_recipient_campaign_id_status_idx").on(t.tenantId, t.campaignId, t.status),
    tenantIsolationPolicy(),
  ],
);
