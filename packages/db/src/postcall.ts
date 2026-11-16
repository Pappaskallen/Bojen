/**
 * After the call, and pictures of type plates (byggplan step 6.3). The voice agent hands in
 * the call's transcript; the worker summarises it in five points, keeps the outcome and
 * links the call to a job. A picture the customer sends through the link is read for a type
 * plate, and what is read waits on the boat card until the mechanic confirms it.
 */
import {
  normaliseNameplate,
  normaliseSummary,
  scrubSensitive,
  summaryText,
  worthSuggesting,
  type CallSummarizer,
  type NameplateReader,
  type ObjectStorage,
} from "@bojen/core";
import { and, asc, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import type { DayActor } from "./day";
import { scheduleJob } from "./messaging";
import { attachment, call, engine, job, nameplateReading } from "./schema";

type Db = Pick<Database, "select" | "insert" | "update" | "execute">;

export const POST_CALL_TASK = "post_call";
export const NAMEPLATE_TASK = "nameplate_read";

/** The longest transcript kept: a long call, with room to spare. */
export const MAX_TRANSCRIPT = 60_000;

/**
 * The voice agent's transcript of an ended call, scrubbed of card and personal numbers
 * before it is saved (spec 10.5), and the summary asked for. False for an unknown call.
 */
export async function saveTranscript(
  db: Db,
  input: { tenantId: string; callId: string; transcript: string; now: Date },
): Promise<boolean> {
  const updated = await db
    .update(call)
    .set({ transcript: scrubSensitive(input.transcript.slice(0, MAX_TRANSCRIPT)) })
    .where(
      and(eq(call.tenantId, input.tenantId), eq(call.id, input.callId), isNull(call.deletedAt)),
    )
    .returning({ id: call.id });
  if (updated.length === 0) return false;
  await scheduleJob(
    db,
    POST_CALL_TASK,
    { tenantId: input.tenantId, callId: input.callId },
    input.now,
    `post-call:${input.callId}`,
  );
  return true;
}

/** Jobs still open, not yet invoiced or paid, that a call about the customer may be about. */
const SETTLED = ["done", "invoiced", "paid", "cancelled"] as const;

/**
 * The worker's task: the summary in five points first, then what the receptionist itself
 * noted. The outcome the agent gave wins over the summary's. A call that booked nothing is
 * linked to the customer's open job when there is exactly one. Without consent to record,
 * the transcript is gone once it is summarised (spec 10.5).
 */
export async function runPostCall(
  deps: { db: Db; summarizer: CallSummarizer },
  tenantId: string,
  callId: string,
): Promise<"summarised" | "skipped"> {
  const [c] = await deps.db
    .select()
    .from(call)
    .where(and(eq(call.tenantId, tenantId), eq(call.id, callId)));
  if (!c?.transcript) return "skipped";
  const summary = normaliseSummary(await deps.summarizer.summarize(c.transcript));
  const noted = c.summary?.trim();

  let jobId = c.jobId;
  if (!jobId && c.customerId) {
    const open = await deps.db
      .select({ id: job.id })
      .from(job)
      .where(
        and(
          eq(job.tenantId, tenantId),
          eq(job.customerId, c.customerId),
          isNull(job.deletedAt),
          notInArray(job.pipelineStatus, [...SETTLED]),
        ),
      )
      .limit(2);
    if (open.length === 1) jobId = open[0]?.id ?? null;
  }

  await deps.db
    .update(call)
    .set({
      summary: [summaryText(summary), noted ? `Receptionistens anteckning: ${noted}` : ""]
        .filter(Boolean)
        .join("\n"),
      outcome: c.outcome ?? summary.outcome,
      jobId,
      ...(c.recordingAllowed ? {} : { transcript: null }),
    })
    .where(and(eq(call.tenantId, tenantId), eq(call.id, callId)));
  return "summarised";
}

/** Asks for a picture to be read for a type plate. */
export async function scheduleNameplate(db: Db, tenantId: string, attachmentId: string, now: Date) {
  await scheduleJob(
    db,
    NAMEPLATE_TASK,
    { tenantId, attachmentId },
    now,
    `nameplate:${attachmentId}`,
  );
}

/**
 * The worker's task: a picture on a job is read, and a reading worth showing is kept as a
 * suggestion for the job's boat. Once per picture.
 */
export async function readNameplate(
  deps: { db: Db; storage: ObjectStorage; reader: NameplateReader },
  tenantId: string,
  attachmentId: string,
): Promise<"suggested" | "nothing" | "skipped"> {
  const [picture] = await deps.db
    .select({
      key: attachment.storageKey,
      contentType: attachment.contentType,
      ownerType: attachment.ownerType,
      ownerId: attachment.ownerId,
    })
    .from(attachment)
    .where(
      and(
        eq(attachment.tenantId, tenantId),
        eq(attachment.id, attachmentId),
        isNull(attachment.deletedAt),
      ),
    );
  if (!picture?.contentType.startsWith("image/") || picture.ownerType !== "job") return "skipped";
  const [owner] = await deps.db
    .select({ boatId: job.boatId })
    .from(job)
    .where(and(eq(job.tenantId, tenantId), eq(job.id, picture.ownerId)));
  if (!owner?.boatId) return "skipped";
  const [done] = await deps.db
    .select({ id: nameplateReading.id })
    .from(nameplateReading)
    .where(
      and(eq(nameplateReading.tenantId, tenantId), eq(nameplateReading.attachmentId, attachmentId)),
    );
  if (done) return "skipped";

  const reading = normaliseNameplate(
    await deps.reader.read({
      bytes: await deps.storage.get(picture.key),
      contentType: picture.contentType,
    }),
  );
  if (!worthSuggesting(reading)) return "nothing";
  await deps.db
    .insert(nameplateReading)
    .values({
      tenantId,
      attachmentId,
      boatId: owner.boatId,
      make: reading.make,
      model: reading.model,
      serialNumber: reading.serialNumber,
      confidence: reading.confidence.toFixed(2),
      readBy: deps.reader.name,
    })
    .onConflictDoNothing();
  return "suggested";
}

export interface NameplateSuggestion {
  id: string;
  attachmentId: string;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  confidence: number;
  createdAt: Date;
}

/** The boat's suggestions still waiting for the mechanic, newest first. */
export async function nameplateSuggestions(
  db: Db,
  tenantId: string,
  boatId: string,
): Promise<NameplateSuggestion[]> {
  const rows = await db
    .select({
      id: nameplateReading.id,
      attachmentId: nameplateReading.attachmentId,
      make: nameplateReading.make,
      model: nameplateReading.model,
      serialNumber: nameplateReading.serialNumber,
      confidence: nameplateReading.confidence,
      createdAt: nameplateReading.createdAt,
    })
    .from(nameplateReading)
    .where(
      and(
        eq(nameplateReading.tenantId, tenantId),
        eq(nameplateReading.boatId, boatId),
        eq(nameplateReading.status, "suggested"),
        isNull(nameplateReading.deletedAt),
      ),
    )
    .orderBy(desc(nameplateReading.createdAt));
  return rows.map((r) => ({ ...r, confidence: Number(r.confidence) }));
}

export class NameplateError extends Error {
  constructor(readonly code: "not_found" | "decided") {
    super(code);
    this.name = "NameplateError";
  }
}

/**
 * The mechanic's decision. Confirmed: what was read goes onto the engine (the one chosen,
 * else the boat's first, else a new one); a field the plate did not give is left as it was.
 * Dismissed: nothing changes on the boat. `engineId` "new" puts it on a new engine.
 */
export async function decideNameplate(
  db: Pick<Database, "transaction">,
  actor: DayActor,
  readingId: string,
  decision: "confirm" | "dismiss",
  engineId?: string | "new",
): Promise<{ engineId: string | null }> {
  return db.transaction(async (tx) => {
    const [reading] = await tx
      .select()
      .from(nameplateReading)
      .where(and(eq(nameplateReading.tenantId, actor.tenantId), eq(nameplateReading.id, readingId)))
      .for("update");
    if (!reading || reading.deletedAt) throw new NameplateError("not_found");
    if (reading.status !== "suggested") throw new NameplateError("decided");
    const decided = { decidedBy: actor.userId, decidedAt: sql`now()` };
    if (decision === "dismiss") {
      await tx
        .update(nameplateReading)
        .set({ status: "dismissed", ...decided })
        .where(eq(nameplateReading.id, readingId));
      return { engineId: null };
    }
    const engines = await tx
      .select({ id: engine.id })
      .from(engine)
      .where(
        and(
          eq(engine.tenantId, actor.tenantId),
          eq(engine.boatId, reading.boatId),
          isNull(engine.deletedAt),
        ),
      )
      .orderBy(asc(engine.position), asc(engine.createdAt));
    let target =
      engineId === "new"
        ? undefined
        : engineId
          ? engines.find((e) => e.id === engineId)?.id
          : engines[0]?.id;
    if (engineId && engineId !== "new" && !target) throw new NameplateError("not_found");
    const values = {
      ...(reading.make ? { make: reading.make } : {}),
      ...(reading.model ? { model: reading.model } : {}),
      ...(reading.serialNumber ? { serialNumber: reading.serialNumber } : {}),
    };
    if (target) {
      await tx
        .update(engine)
        .set(values)
        .where(and(eq(engine.tenantId, actor.tenantId), eq(engine.id, target)));
    } else {
      const [created] = await tx
        .insert(engine)
        .values({ tenantId: actor.tenantId, boatId: reading.boatId, ...values })
        .returning({ id: engine.id });
      target = created?.id;
    }
    await tx
      .update(nameplateReading)
      .set({ status: "confirmed", engineId: target ?? null, ...decided })
      .where(eq(nameplateReading.id, readingId));
    return { engineId: target ?? null };
  });
}

/** The firm of a call, for the voice agent's transcript, which it sends with its own secret. */
export async function tenantOfCall(db: Db, callId: string): Promise<string | null> {
  const [row] = await db.select({ tenantId: call.tenantId }).from(call).where(eq(call.id, callId));
  return row?.tenantId ?? null;
}
