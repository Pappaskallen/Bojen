import { foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { call } from "./call";
import { customer } from "./customer";
import { taskPriority, taskStatus, taskType } from "./enums";
import { job } from "./job";
import { message } from "./message";
import { tenant } from "./tenant";
import { appUser } from "./user";
import { visit } from "./visit";

/**
 * An internal task for the firm, for example "call the customer back". It points at the
 * object it is about through one or more of the nullable keys.
 */
export const task = pgTable(
  "task",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    type: taskType("type").notNull(),
    status: taskStatus("status").notNull().default("open"),
    priority: taskPriority("priority").notNull().default("normal"),
    title: text("title").notNull(),
    note: text("note"),
    assigneeId: uuid("assignee_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    customerId: uuid("customer_id"),
    jobId: uuid("job_id"),
    visitId: uuid("visit_id"),
    callId: uuid("call_id"),
    messageId: uuid("message_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "task_assignee_fk",
      columns: [t.tenantId, t.assigneeId],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    foreignKey({
      name: "task_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    foreignKey({
      name: "task_job_fk",
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
    foreignKey({
      name: "task_visit_fk",
      columns: [t.tenantId, t.visitId],
      foreignColumns: [visit.tenantId, visit.id],
    }),
    foreignKey({
      name: "task_call_fk",
      columns: [t.tenantId, t.callId],
      foreignColumns: [call.tenantId, call.id],
    }),
    foreignKey({
      name: "task_message_fk",
      columns: [t.tenantId, t.messageId],
      foreignColumns: [message.tenantId, message.id],
    }),
    // The open-task list, soonest due first (byggplan 1.4).
    index("task_tenant_id_status_due_at_idx").on(t.tenantId, t.status, t.dueAt),
    tenantIsolationPolicy(),
  ],
);
