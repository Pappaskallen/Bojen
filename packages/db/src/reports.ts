/**
 * The service report and the invoice basis (byggplan step 5.5d). When a visit is done the
 * report starts as `drafting` and the price list proposes the invoice lines; the worker then
 * writes out the voice notes and asks the report writer for a draft. The mechanic changes it
 * and approves it, which sends it to the customer (F7) and fixes the invoice basis for Fortnox
 * (step 8). An approved report no longer changes.
 */
import {
  bookingSettings,
  invoiceTotals,
  normaliseDraft,
  proposedLines,
  reportContent,
  workDonePoints,
  workDoneText,
  RECOMMENDATION_PRIORITIES,
  type InvoiceLine,
  type ObjectStorage,
  type Recommendation,
  type ReportFacts,
  type ReportWriter,
  type Transcriber,
} from "@bojen/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { type DayActor, hasBoatPicture, ownVisit } from "./day";
import { scheduleJob } from "./messaging";
import {
  attachment,
  boat,
  customer,
  domainEvent,
  engine,
  engineHoursReading,
  job,
  jobLine,
  jobPart,
  part,
  serviceReport,
  serviceType,
  tenant,
  visit,
  type StoredInvoice,
} from "./schema";

type Db = Pick<Database, "select" | "insert" | "update" | "execute">;

/** The worker's task that writes the draft: { tenantId, visitId }. */
export const REPORT_TASK = "report_draft";

export class ReportError extends Error {
  constructor(readonly code: "not_found" | "forbidden" | "invalid_input" | "approved" | "empty") {
    super(code);
    this.name = "ReportError";
  }
}

/**
 * Called in the transaction that marks the visit done: the report waits for its draft, the
 * worker is asked to write it, and a job without invoice lines gets the price list's.
 */
export async function startReport(db: Db, tenantId: string, visitId: string, now: Date) {
  const started = await db
    .insert(serviceReport)
    .values({ tenantId, visitId })
    .onConflictDoNothing()
    .returning({ id: serviceReport.id });
  if (started.length === 0) return;
  await scheduleJob(db, REPORT_TASK, { tenantId, visitId }, now, `report:${visitId}`, 5);

  const [row] = await db
    .select({
      jobId: job.id,
      urgency: job.urgency,
      service: serviceType.name,
      priceOre: serviceType.priceOre,
      settings: tenant.settings,
      lines: sql<number>`(select count(*)::int from job_line l
        where l.tenant_id = job.tenant_id and l.job_id = job.id and l.deleted_at is null)`,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .innerJoin(tenant, eq(tenant.id, visit.tenantId))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .where(and(eq(visit.tenantId, tenantId), eq(visit.id, visitId)));
  if (!row || row.lines > 0) return;
  const settings = bookingSettings(row.settings);
  const lines = proposedLines({
    service: row.service ? { name: row.service, priceOre: row.priceOre } : null,
    calloutPriceOre: settings.calloutPriceOre,
    emergencySurchargeOre: settings.emergencySurchargeOre,
    urgency: row.urgency,
  });
  if (lines.length === 0) return;
  await db.insert(jobLine).values(
    lines.map((l) => ({
      tenantId,
      jobId: row.jobId,
      type: l.type,
      description: l.description,
      hours: l.hours === null ? null : String(l.hours),
      unitPriceOre: l.unitPriceOre,
    })),
  );
}

const labelOf = (make: string | null, model: string | null) =>
  [make, model].filter(Boolean).join(" ") || null;

/**
 * What the visit recorded, as the draft's input. Running hours "now" are the latest reading
 * since the visit started, "previous" the one before; nothing about the customer is included.
 */
export async function reportFacts(db: Db, tenantId: string, visitId: string): Promise<ReportFacts> {
  const [v] = await db
    .select({
      jobId: job.id,
      boatId: job.boatId,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((x: string) => new Date(x)),
      notes: visit.notes,
      description: job.description,
      service: serviceType.name,
      boatName: boat.name,
      boatMake: boat.make,
      boatModel: boat.model,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .leftJoin(boat, and(eq(boat.tenantId, job.tenantId), eq(boat.id, job.boatId)))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .where(and(eq(visit.tenantId, tenantId), eq(visit.id, visitId), isNull(visit.deletedAt)));
  if (!v) throw new ReportError("not_found");

  const engines = v.boatId
    ? await db
        .select({ id: engine.id, make: engine.make, model: engine.model })
        .from(engine)
        .where(
          and(eq(engine.tenantId, tenantId), eq(engine.boatId, v.boatId), isNull(engine.deletedAt)),
        )
        .orderBy(asc(engine.position), asc(engine.createdAt))
    : [];
  const engineFacts = [];
  for (const e of engines) {
    const readings = await db
      .select({ hours: engineHoursReading.hours, readAt: engineHoursReading.readAt })
      .from(engineHoursReading)
      .where(
        and(
          eq(engineHoursReading.tenantId, tenantId),
          eq(engineHoursReading.engineId, e.id),
          isNull(engineHoursReading.deletedAt),
        ),
      )
      .orderBy(desc(engineHoursReading.readAt))
      .limit(2);
    const [latest, before] = readings;
    const now = latest && latest.readAt >= v.start ? Number(latest.hours) : null;
    const previous = now === null ? latest : before;
    engineFacts.push({
      label: labelOf(e.make, e.model) ?? "Motor",
      hours: now,
      previousHours: previous ? Number(previous.hours) : null,
    });
  }

  const parts = await db
    .select({
      articleNumber: part.articleNumber,
      description: part.description,
      quantity: jobPart.quantity,
      status: jobPart.status,
    })
    .from(jobPart)
    .innerJoin(part, and(eq(part.tenantId, jobPart.tenantId), eq(part.id, jobPart.partId)))
    .where(
      and(eq(jobPart.tenantId, tenantId), eq(jobPart.jobId, v.jobId), isNull(jobPart.deletedAt)),
    )
    .orderBy(asc(jobPart.createdAt));

  const files = await db
    .select({ contentType: attachment.contentType, transcript: attachment.transcript })
    .from(attachment)
    .where(
      and(
        eq(attachment.tenantId, tenantId),
        eq(attachment.ownerType, "visit"),
        eq(attachment.ownerId, visitId),
        isNull(attachment.deletedAt),
      ),
    )
    .orderBy(asc(attachment.createdAt));

  return {
    service: v.service,
    description: v.description,
    boat: v.boatName ?? labelOf(v.boatMake, v.boatModel),
    engines: engineFacts,
    parts: parts.map((p) => ({
      articleNumber: p.articleNumber,
      description: p.description,
      quantity: Number(p.quantity),
      status: p.status,
    })),
    notes: v.notes,
    voiceNotes: files.flatMap((f) =>
      f.contentType.startsWith("audio/") && f.transcript ? [f.transcript] : [],
    ),
    photos: files.filter((f) => f.contentType.startsWith("image/")).length,
  };
}

export interface DraftDeps {
  db: Db;
  storage: ObjectStorage;
  writer: ReportWriter;
  /** Null until speech to text is set up: the voice notes then wait, unread. */
  transcriber: Transcriber | null;
  now: () => Date;
}

/**
 * The worker's task: writes out the voice notes, then asks for the draft. A report the
 * mechanic has already written in, or approved, is left alone. A failing call throws, so the
 * worker tries again.
 */
export async function writeReportDraft(
  deps: DraftDeps,
  tenantId: string,
  visitId: string,
): Promise<"drafted" | "skipped"> {
  const [report] = await deps.db
    .select({ status: serviceReport.status })
    .from(serviceReport)
    .where(and(eq(serviceReport.tenantId, tenantId), eq(serviceReport.visitId, visitId)));
  if (report?.status !== "drafting") return "skipped";

  if (deps.transcriber) {
    const waiting = await deps.db
      .select({ id: attachment.id, key: attachment.storageKey, type: attachment.contentType })
      .from(attachment)
      .where(
        and(
          eq(attachment.tenantId, tenantId),
          eq(attachment.ownerType, "visit"),
          eq(attachment.ownerId, visitId),
          isNull(attachment.deletedAt),
          isNull(attachment.transcript),
          sql`${attachment.contentType} like 'audio/%'`,
        ),
      );
    for (const w of waiting) {
      const text = await deps.transcriber.transcribe({
        bytes: await deps.storage.get(w.key),
        contentType: w.type,
      });
      await deps.db
        .update(attachment)
        .set({ transcript: text.trim() })
        .where(and(eq(attachment.tenantId, tenantId), eq(attachment.id, w.id)));
    }
  }

  const facts = await reportFacts(deps.db, tenantId, visitId);
  const draft = normaliseDraft(await deps.writer.draft(facts));
  const written = await deps.db
    .update(serviceReport)
    .set({
      status: "draft",
      workDone: workDoneText(draft.workDone),
      recommendations: draft.recommendations,
      nextService: draft.nextService,
      draftedBy: deps.writer.name,
      draftedAt: deps.now(),
    })
    .where(
      and(
        eq(serviceReport.tenantId, tenantId),
        eq(serviceReport.visitId, visitId),
        eq(serviceReport.status, "drafting"),
      ),
    )
    .returning({ id: serviceReport.id });
  return written.length > 0 ? "drafted" : "skipped";
}

export interface ReportLine extends InvoiceLine {
  /** The job line's id; null for a part, which is changed in the day view. */
  id: string | null;
  amountOre: number;
  /** A part without a sale price, which is left out of the sums until it has one. */
  noPrice?: boolean;
}

export interface ReportView {
  visitId: string;
  boat: { id: string; label: string } | null;
  /** The boat has a picture (`visitBoatPicture`), shown at the top. */
  boatPicture: boolean;
  status: "drafting" | "draft" | "approved";
  customer: string;
  service: string | null;
  start: Date;
  visitStatus: string;
  workDone: string;
  recommendations: Recommendation[];
  nextService: string | null;
  draftedBy: string | null;
  approvedAt: Date | null;
  facts: ReportFacts;
  /** Voice notes not yet written out. */
  untranscribed: number;
  lines: ReportLine[];
  netOre: number;
  vatOre: number;
  grossOre: number;
  hourlyRateOre: number | null;
}

async function reportRow(db: Db, tenantId: string, visitId: string) {
  const [row] = await db
    .select()
    .from(serviceReport)
    .where(
      and(
        eq(serviceReport.tenantId, tenantId),
        eq(serviceReport.visitId, visitId),
        isNull(serviceReport.deletedAt),
      ),
    );
  return row;
}

/** The invoice basis: the job's lines, then the installed parts at their sale price. */
async function invoiceLines(db: Db, tenantId: string, jobId: string): Promise<ReportLine[]> {
  const lines = await db
    .select()
    .from(jobLine)
    .where(and(eq(jobLine.tenantId, tenantId), eq(jobLine.jobId, jobId), isNull(jobLine.deletedAt)))
    .orderBy(asc(jobLine.createdAt));
  const parts = await db
    .select({
      description: part.description,
      articleNumber: part.articleNumber,
      quantity: jobPart.quantity,
      priceOre: part.salePriceOre,
    })
    .from(jobPart)
    .innerJoin(part, and(eq(part.tenantId, jobPart.tenantId), eq(part.id, jobPart.partId)))
    .where(
      and(
        eq(jobPart.tenantId, tenantId),
        eq(jobPart.jobId, jobId),
        eq(jobPart.status, "installed"),
        isNull(jobPart.deletedAt),
      ),
    )
    .orderBy(asc(jobPart.createdAt));
  const own: InvoiceLine[] = lines.map((l) => ({
    type: l.type,
    description: l.description,
    quantity: l.hours === null ? 1 : Number(l.hours),
    unitPriceOre: l.unitPriceOre,
  }));
  const totals = invoiceTotals(own);
  return [
    ...totals.lines.map((l, i) => ({ ...l, id: lines[i]?.id ?? null })),
    ...parts.map((p) => {
      const quantity = Number(p.quantity);
      return {
        id: null,
        type: "part" as const,
        description: `${p.description} (${p.articleNumber})`,
        quantity,
        unitPriceOre: p.priceOre ?? 0,
        amountOre: Math.round(quantity * (p.priceOre ?? 0)),
        ...(p.priceOre === null ? { noPrice: true } : {}),
      };
    }),
  ];
}

/** The visit, if the person may work on it, with the day view's refusals as report errors. */
async function visitFor(db: Db, actor: DayActor, visitId: string) {
  try {
    return await ownVisit(db, actor, visitId);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "not_found" || code === "forbidden") throw new ReportError(code);
    throw error;
  }
}

/** The report page: the report, what it is built on and the invoice basis. */
export async function reportView(db: Db, actor: DayActor, visitId: string): Promise<ReportView> {
  const own = await visitFor(db, actor, visitId);
  const report = await reportRow(db, actor.tenantId, visitId);
  if (!report) throw new ReportError("not_found");
  const [v] = await db
    .select({
      status: visit.status,
      customer: customer.name,
      service: serviceType.name,
      settings: tenant.settings,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .innerJoin(customer, and(eq(customer.tenantId, job.tenantId), eq(customer.id, job.customerId)))
    .innerJoin(tenant, eq(tenant.id, visit.tenantId))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .where(and(eq(visit.tenantId, actor.tenantId), eq(visit.id, visitId)));
  if (!v) throw new ReportError("not_found");
  const facts = await reportFacts(db, actor.tenantId, visitId);
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attachment)
    .where(
      and(
        eq(attachment.tenantId, actor.tenantId),
        eq(attachment.ownerType, "visit"),
        eq(attachment.ownerId, visitId),
        isNull(attachment.deletedAt),
        isNull(attachment.transcript),
        sql`${attachment.contentType} like 'audio/%'`,
      ),
    );
  const lines: ReportLine[] =
    report.status === "approved" && report.invoice
      ? report.invoice.lines.map((l) => ({ ...l, id: null }))
      : await invoiceLines(db, actor.tenantId, own.jobId);
  const priced = lines.filter((l) => !l.noPrice);
  const totals = invoiceTotals(priced);
  return {
    visitId,
    boat: own.boatId ? { id: own.boatId, label: facts.boat ?? "–" } : null,
    boatPicture: await hasBoatPicture(db, actor.tenantId, { boatId: own.boatId, jobId: own.jobId }),
    status: report.status as ReportView["status"],
    customer: v.customer,
    service: v.service,
    start: own.start,
    visitStatus: v.status,
    workDone: report.workDone ?? "",
    recommendations: report.recommendations,
    nextService: report.nextService,
    draftedBy: report.draftedBy,
    approvedAt: report.approvedAt,
    facts,
    untranscribed: waiting?.n ?? 0,
    lines,
    netOre: totals.netOre,
    vatOre: totals.vatOre,
    grossOre: totals.grossOre,
    hourlyRateOre: bookingSettings(v.settings).hourlyRateOre,
  };
}

/** The report and the visit's job, if the person may change it and it is not approved. */
async function openReport(db: Db, actor: DayActor, visitId: string) {
  const own = await visitFor(db, actor, visitId);
  const report = await reportRow(db, actor.tenantId, visitId);
  if (!report) throw new ReportError("not_found");
  if (report.status === "approved") throw new ReportError("approved");
  return { report, jobId: own.jobId };
}

export const MAX_REPORT_TEXT = 6000;

export interface ReportInput {
  workDone: string;
  recommendations: { text: string; priority: string }[];
  nextService: string;
}

function cleanInput(input: ReportInput) {
  if (input.workDone.length > MAX_REPORT_TEXT || input.nextService.length > 300) {
    throw new ReportError("invalid_input");
  }
  const draft = normaliseDraft({
    workDone: workDonePoints(input.workDone),
    recommendations: input.recommendations,
    nextService: input.nextService,
  });
  for (const r of input.recommendations) {
    if (r.text.trim() && !RECOMMENDATION_PRIORITIES.includes(r.priority as never)) {
      throw new ReportError("invalid_input");
    }
  }
  return draft;
}

/** The mechanic's own text: it replaces the draft, and a draft still being written is dropped. */
export async function saveReport(db: Db, actor: DayActor, visitId: string, input: ReportInput) {
  const draft = cleanInput(input);
  const { report } = await openReport(db, actor, visitId);
  await db
    .update(serviceReport)
    .set({
      status: "draft",
      workDone: workDoneText(draft.workDone),
      recommendations: draft.recommendations,
      nextService: draft.nextService,
      draftedBy: report.draftedBy ?? "mechanic",
    })
    .where(and(eq(serviceReport.tenantId, actor.tenantId), eq(serviceReport.id, report.id)));
}

const LINE_TYPES = ["labour", "callout", "emergency", "discount"] as const;

/** A line of the invoice basis, typed by the mechanic: extra hours, a discount. */
export async function addInvoiceLine(
  db: Db,
  actor: DayActor,
  visitId: string,
  input: { type: string; description: string; quantity: number; unitPriceOre: number },
) {
  const type = LINE_TYPES.find((t) => t === input.type);
  const description = input.description.trim();
  if (
    !type ||
    !description ||
    description.length > 200 ||
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0 ||
    input.quantity > 1000 ||
    !Number.isInteger(input.unitPriceOre) ||
    Math.abs(input.unitPriceOre) > 100_000_000 ||
    (type === "discount") !== input.unitPriceOre < 0
  ) {
    throw new ReportError("invalid_input");
  }
  const { jobId } = await openReport(db, actor, visitId);
  const [row] = await db
    .insert(jobLine)
    .values({
      tenantId: actor.tenantId,
      jobId,
      type,
      description,
      hours: input.quantity === 1 ? null : input.quantity.toFixed(2),
      unitPriceOre: input.unitPriceOre,
    })
    .returning({ id: jobLine.id });
  if (!row) throw new Error("job line not created");
  return row.id;
}

/** Takes a line off the invoice basis (kept, marked deleted). */
export async function removeInvoiceLine(db: Db, actor: DayActor, visitId: string, lineId: string) {
  const { jobId } = await openReport(db, actor, visitId);
  const removed = await db
    .update(jobLine)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(jobLine.tenantId, actor.tenantId),
        eq(jobLine.id, lineId),
        eq(jobLine.jobId, jobId),
        isNull(jobLine.deletedAt),
      ),
    )
    .returning({ id: jobLine.id });
  if (removed.length === 0) throw new ReportError("not_found");
}

/**
 * The mechanic approves: the text as it stands and the invoice basis are fixed, and
 * `report.approved` sends the report to the customer (F7). Approving twice does nothing new.
 */
export async function approveReport(
  deps: { db: Pick<Database, "transaction">; now: () => Date },
  actor: DayActor,
  visitId: string,
  input: ReportInput,
): Promise<void> {
  const draft = cleanInput(input);
  if (draft.workDone.length === 0) throw new ReportError("empty");
  await deps.db.transaction(async (tx) => {
    const { report, jobId } = await openReport(tx, actor, visitId);
    // One approval at a time: a second one waits here and then finds it approved.
    await tx.execute(sql`select 1 from service_report where id = ${report.id} for update`);
    const [again] = await tx
      .select({ status: serviceReport.status })
      .from(serviceReport)
      .where(eq(serviceReport.id, report.id));
    if (again?.status === "approved") throw new ReportError("approved");

    const lines = (await invoiceLines(tx, actor.tenantId, jobId)).filter((l) => !l.noPrice);
    const totals = invoiceTotals(lines);
    const invoice: StoredInvoice = {
      lines: totals.lines.map((l) => ({
        type: l.type,
        description: l.description,
        quantity: l.quantity,
        unitPriceOre: l.unitPriceOre,
        amountOre: l.amountOre,
      })),
      netOre: totals.netOre,
      vatOre: totals.vatOre,
      grossOre: totals.grossOre,
    };
    const now = deps.now();
    await tx
      .update(serviceReport)
      .set({
        status: "approved",
        workDone: workDoneText(draft.workDone),
        recommendations: draft.recommendations,
        nextService: draft.nextService,
        draftedBy: report.draftedBy ?? "mechanic",
        approvedAt: now,
        approvedBy: actor.userId,
        invoice,
      })
      .where(eq(serviceReport.id, report.id));
    const facts = await reportFacts(tx, actor.tenantId, visitId);
    await tx.insert(domainEvent).values({
      tenantId: actor.tenantId,
      aggregateType: "visit",
      aggregateId: visitId,
      type: "report.approved",
      payload: { visitId, ...reportContent(draft, facts) },
      actorType: "staff",
      actorId: actor.userId,
      occurredAt: now,
    });
  });
}
