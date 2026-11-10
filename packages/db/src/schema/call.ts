import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { customer } from "./customer";
import { callOutcome } from "./enums";
import { job } from "./job";
import { tenant } from "./tenant";

/**
 * A call answered by the AI receptionist. Audio lives in S3 (eu-north-1); only its key is
 * stored here. The transcript is scrubbed of card and personal identity numbers before it
 * is saved (spec 10.5).
 */
export const call = pgTable(
  "call",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    callerNumber: text("caller_number"),
    /** Empty when the number is not in the register. */
    customerId: uuid("customer_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    recordingAllowed: boolean("recording_allowed").notNull().default(false),
    audioKey: text("audio_key"),
    transcript: text("transcript"),
    summary: text("summary"),
    outcome: callOutcome("outcome"),
    /** The job the call created, if any. */
    jobId: uuid("job_id"),
    /** What the call cost in the voice pipeline, in öre (KPI 25). */
    costOre: integer("cost_ore"),
    /** The telephony provider's id for the call. */
    externalId: text("external_id"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "call_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    foreignKey({
      name: "call_job_fk",
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
    unique("call_tenant_id_id_key").on(t.tenantId, t.id),
    check("call_caller_number_e164", isE164(t.callerNumber)),
    index("call_tenant_id_started_at_idx").on(t.tenantId, t.startedAt),
    index("call_customer_id_idx").on(t.tenantId, t.customerId),
    tenantIsolationPolicy(),
  ],
);
