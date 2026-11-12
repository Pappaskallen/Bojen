import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";
import { baseColumns, currentTenantId, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";

const ownTenant = sql`"tenant_id" = ${currentTenantId}`;

/**
 * Everything that happened to a booking, in order (byggplan step 2.4). Written in the same
 * transaction as the change itself, so the worker can later send sms and e-mail from it
 * (phase 3). Append-only for signed-in users, like `audit_log`.
 */
export const domainEvent = pgTable(
  "domain_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    /** For example `visit.created`, `visit.rescheduled`, `visit.cancelled`. */
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    /** `customer`, `staff` or `system`. */
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    index("domain_event_aggregate_idx").on(
      t.tenantId,
      t.aggregateType,
      t.aggregateId,
      t.occurredAt,
    ),
    pgPolicy("tenant_read", { for: "select", to: authenticatedRole, using: ownTenant }),
    pgPolicy("tenant_append", { for: "insert", to: authenticatedRole, withCheck: ownTenant }),
  ],
);

/**
 * Answers to requests that carried an `Idempotency-Key`. A repeated request with the same
 * key gets the stored answer instead of a second booking.
 */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    /** SHA-256 of the operation and its input; the same key with other input is refused. */
    requestHash: text("request_hash").notNull(),
    responseStatus: smallint("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    /** Number of times the stored answer was replayed. */
    replays: integer("replays").notNull().default(0),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("idempotency_key_tenant_key").on(t.tenantId, t.key),
    tenantIsolationPolicy(),
  ],
);
