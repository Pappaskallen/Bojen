/**
 * The pipeline board and its moves (byggplan step 5.4, spec C4). A card is a job. Staff drag
 * cards between columns; two moves happen on their own: the last visit done makes the job
 * done (in `changeBooking`), and an invoice makes it invoiced (the worker, on `invoice.created`).
 * Every move is written to `domain_event` as `job.pipeline_moved`.
 */
import {
  PIPELINE_COLUMNS,
  isPipelineStatus,
  mayMoveCard,
  statusAfterInvoice,
  statusAfterVisitDone,
  type PipelineColumn,
  type PipelineStatus,
} from "@bojen/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { domainEvent, job } from "./schema";

type Db = Pick<Database, "select" | "update" | "insert" | "execute">;

/** How many cards the columns at the end show; they only grow. */
export const SETTLED_LIMIT = 50;
const SETTLED: readonly PipelineColumn[] = ["done", "invoiced", "paid"];

export interface PipelineCard {
  jobId: string;
  status: PipelineColumn;
  customerId: string;
  customer: string;
  boatId: string | null;
  boat: string | null;
  service: string | null;
  /** The next visit that is not done or cancelled, else the latest. */
  visitStart: Date | null;
  mechanicIds: string[];
  updatedAt: Date;
}

export type PipelineBoard = Record<PipelineColumn, PipelineCard[]>;

type CardRow = {
  job_id: string;
  status: PipelineColumn;
  customer_id: string;
  customer: string;
  boat_id: string | null;
  boat_name: string | null;
  boat_make: string | null;
  boat_model: string | null;
  service: string | null;
  next_start: string | null;
  last_start: string | null;
  mechanic_ids: string[] | null;
  updated_at: string;
};

/**
 * Every job of the firm by column. The open columns show all their cards, soonest visit
 * first; done, invoiced and paid the latest `SETTLED_LIMIT` each.
 */
export async function pipelineBoard(db: Db, tenantId: string): Promise<PipelineBoard> {
  const rows = (await db.execute<CardRow>(sql`
    with cards as (
      select j.id as job_id, j.pipeline_status as status, j.updated_at,
             c.id as customer_id, c.name as customer,
             b.id as boat_id, b.name as boat_name, b.make as boat_make, b.model as boat_model,
             st.name as service,
             (select min(lower(v.time_window)) from visit v
               where v.tenant_id = j.tenant_id and v.job_id = j.id and v.deleted_at is null
                 and v.status not in ('done', 'cancelled', 'no_access')) as next_start,
             (select max(lower(v.time_window)) from visit v
               where v.tenant_id = j.tenant_id and v.job_id = j.id and v.deleted_at is null)
               as last_start,
             (select array_agg(distinct v.mechanic_id) from visit v
               where v.tenant_id = j.tenant_id and v.job_id = j.id and v.deleted_at is null
                 and v.mechanic_id is not null) as mechanic_ids,
             row_number() over (partition by j.pipeline_status order by j.updated_at desc) as n
      from job j
      join customer c on c.tenant_id = j.tenant_id and c.id = j.customer_id
      left join boat b on b.tenant_id = j.tenant_id and b.id = j.boat_id and b.deleted_at is null
      left join service_type st on st.tenant_id = j.tenant_id and st.id = j.service_type_id
      where j.tenant_id = ${tenantId} and j.deleted_at is null
        and j.pipeline_status <> 'cancelled'
    )
    select * from cards
    where status not in ('done', 'invoiced', 'paid') or n <= ${SETTLED_LIMIT}`)) as unknown as CardRow[];

  const board = Object.fromEntries(
    PIPELINE_COLUMNS.map((c) => [c, []]),
  ) as unknown as PipelineBoard;
  for (const r of rows) {
    const start = r.next_start ?? r.last_start;
    const makeModel = [r.boat_make, r.boat_model].filter(Boolean).join(" ");
    board[r.status].push({
      jobId: r.job_id,
      status: r.status,
      customerId: r.customer_id,
      customer: r.customer,
      boatId: r.boat_id,
      boat: r.boat_name ?? (makeModel || null),
      service: r.service,
      visitStart: start ? new Date(start) : null,
      mechanicIds: r.mechanic_ids ?? [],
      updatedAt: new Date(r.updated_at),
    });
  }
  for (const column of PIPELINE_COLUMNS) {
    board[column].sort((a, b) =>
      SETTLED.includes(column)
        ? b.updatedAt.getTime() - a.updatedAt.getTime()
        : (a.visitStart?.getTime() ?? Infinity) - (b.visitStart?.getTime() ?? Infinity),
    );
  }
  return board;
}

export class PipelineError extends Error {
  constructor(readonly code: "not_found" | "forbidden" | "invalid_input") {
    super(code);
    this.name = "PipelineError";
  }
}

export interface PipelineMover {
  tenantId: string;
  userId: string;
  role: "owner" | "admin" | "mechanic";
}

async function setStatus(
  db: Db,
  tenantId: string,
  jobId: string,
  from: PipelineStatus,
  to: PipelineStatus,
  actor: { type: "staff" | "system"; id: string | null },
  why: string,
  at?: Date,
) {
  // Only from the status the caller saw, so two moves at once do not both win.
  const moved = await db
    .update(job)
    .set({ pipelineStatus: to })
    .where(and(eq(job.tenantId, tenantId), eq(job.id, jobId), eq(job.pipelineStatus, from)))
    .returning({ id: job.id });
  if (moved.length === 0) return false;
  await db.insert(domainEvent).values({
    tenantId,
    aggregateType: "job",
    aggregateId: jobId,
    type: "job.pipeline_moved",
    payload: { from, to, why },
    actorType: actor.type,
    actorId: actor.id,
    ...(at ? { occurredAt: at } : {}),
  });
  return true;
}

/** Moves a card by hand. A mechanic may move only a job where they have a visit. */
export async function moveCard(
  db: Db,
  mover: PipelineMover,
  jobId: string,
  to: unknown,
): Promise<PipelineStatus> {
  if (!isPipelineStatus(to)) throw new PipelineError("invalid_input");
  const [found] = await db
    .select({
      status: job.pipelineStatus,
      // The outer columns by table name: a one-table query renders them unqualified.
      own: sql<boolean>`exists (select 1 from visit v where v.tenant_id = job.tenant_id
        and v.job_id = job.id and v.mechanic_id = ${mover.userId} and v.deleted_at is null)`,
    })
    .from(job)
    .where(and(eq(job.tenantId, mover.tenantId), eq(job.id, jobId), isNull(job.deletedAt)));
  if (!found) throw new PipelineError("not_found");
  if (!mayMoveCard(mover.role, found.own)) throw new PipelineError("forbidden");
  if (found.status === to) return to;
  const moved = await setStatus(
    db,
    mover.tenantId,
    jobId,
    found.status,
    to,
    { type: "staff", id: mover.userId },
    "manual",
  );
  if (!moved) throw new PipelineError("not_found");
  return to;
}

/** After a visit is done: the job is done when none of its visits is left (in the same transaction). */
export async function jobAfterVisitDone(db: Db, tenantId: string, jobId: string, at: Date) {
  const [row] = (await db.execute<{ status: PipelineStatus; left: number }>(sql`
    select j.pipeline_status as status,
           (select count(*)::int from visit v
             where v.tenant_id = j.tenant_id and v.job_id = j.id and v.deleted_at is null
               and v.status not in ('done', 'cancelled', 'no_access')) as left
    from job j where j.tenant_id = ${tenantId} and j.id = ${jobId}`)) as unknown as {
    status: PipelineStatus;
    left: number;
  }[];
  if (!row) return;
  const to = statusAfterVisitDone(row.status, row.left);
  if (to)
    await setStatus(
      db,
      tenantId,
      jobId,
      row.status,
      to,
      { type: "system", id: null },
      "visit_done",
      at,
    );
}

/** After an invoice is made for the job (Fortnox, step 8): the card moves to invoiced. */
export async function jobAfterInvoice(db: Db, tenantId: string, jobId: string, at: Date) {
  const [row] = await db
    .select({ status: job.pipelineStatus })
    .from(job)
    .where(and(eq(job.tenantId, tenantId), eq(job.id, jobId), isNull(job.deletedAt)));
  if (!row) return false;
  const to = statusAfterInvoice(row.status);
  if (!to) return false;
  return setStatus(
    db,
    tenantId,
    jobId,
    row.status,
    to,
    { type: "system", id: null },
    "invoice",
    at,
  );
}
