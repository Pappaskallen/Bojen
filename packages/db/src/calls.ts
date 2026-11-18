/**
 * The receptionist's statistics (byggplan step 7.3, spec 9.1 KPI 21–24) and the list of
 * calls, which can be filtered on outcome. Read straight from `call`: a firm has hundreds of
 * calls a month, not more, and the hours outside the office are the firm's own setting.
 */
import {
  receptionistKpis,
  receptionistSettings,
  type CallFilter,
  type ReceptionistKpis,
} from "@bojen/core";
import { and, desc, eq, gte, isNull, lt, type SQL } from "drizzle-orm";
import type { Database } from "./client";
import { call, customer, tenant } from "./schema";

type Db = Pick<Database, "select">;

/** KPI 21–24 for the calls started in [from, to). */
export async function receptionistStats(
  db: Db,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ReceptionistKpis> {
  const [firm] = await db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const calls = await db
    .select({ startedAt: call.startedAt, outcome: call.outcome, intent: call.intent })
    .from(call)
    .where(
      and(
        eq(call.tenantId, tenantId),
        isNull(call.deletedAt),
        gte(call.startedAt, from),
        lt(call.startedAt, to),
      ),
    );
  return receptionistKpis(calls, receptionistSettings(firm?.settings).officeHours);
}

export interface CallListItem {
  id: string;
  startedAt: Date;
  /** The customer's name, or null for a number not in the register. */
  customer: string | null;
  customerId: string | null;
  callerNumber: string | null;
  outcome: string | null;
  intent: string | null;
  summary: string | null;
}

/** The latest calls, newest first, of one outcome when a filter is given. */
export async function callList(
  db: Db,
  tenantId: string,
  filter: CallFilter | null,
  limit = 50,
): Promise<CallListItem[]> {
  const conditions: SQL[] = [eq(call.tenantId, tenantId), isNull(call.deletedAt)];
  if (filter === "none") conditions.push(isNull(call.outcome));
  else if (filter) conditions.push(eq(call.outcome, filter));
  return db
    .select({
      id: call.id,
      startedAt: call.startedAt,
      customer: customer.name,
      customerId: call.customerId,
      callerNumber: call.callerNumber,
      outcome: call.outcome,
      intent: call.intent,
      summary: call.summary,
    })
    .from(call)
    .leftJoin(customer, and(eq(customer.tenantId, call.tenantId), eq(customer.id, call.customerId)))
    .where(and(...conditions))
    .orderBy(desc(call.startedAt))
    .limit(limit);
}
