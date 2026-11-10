import { foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { boat } from "./boat";
import { customer } from "./customer";
import { jobChannel, jobPipelineStatus, jobUrgency } from "./enums";
import { serviceType } from "./service_type";
import { tenant } from "./tenant";

/**
 * A work order and its card in the pipeline. A job can have several visits, for example
 * fault finding first and the repair when the parts have arrived.
 */
export const job = pgTable(
  "job",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    boatId: uuid("boat_id"),
    serviceTypeId: uuid("service_type_id"),
    pipelineStatus: jobPipelineStatus("pipeline_status").notNull().default("inquiry"),
    urgency: jobUrgency("urgency").notNull().default("planned"),
    description: text("description"),
    /** Where the job came from. Empty for jobs the mechanic enters by hand. */
    channel: jobChannel("channel"),
    /** Quoted amount in öre excluding VAT. */
    quoteAmountOre: integer("quote_amount_ore"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "job_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    foreignKey({
      name: "job_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    foreignKey({
      name: "job_service_type_fk",
      columns: [t.tenantId, t.serviceTypeId],
      foreignColumns: [serviceType.tenantId, serviceType.id],
    }),
    unique("job_tenant_id_id_key").on(t.tenantId, t.id),
    index("job_pipeline_status_idx").on(t.tenantId, t.pipelineStatus),
    index("job_customer_id_idx").on(t.tenantId, t.customerId),
    index("job_boat_id_idx").on(t.tenantId, t.boatId),
    tenantIsolationPolicy(),
  ],
);
