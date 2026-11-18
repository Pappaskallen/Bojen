/**
 * Erasure, export and the nightly clean-up of personal data (byggplan step 7.4, spec 10.3).
 *
 * - `eraseCustomer`: the right to erasure, from the customer card. The customer is anonymised
 *   rather than deleted, so jobs, visits and reports keep their rows and the boat's technical
 *   history stays; what identifies the customer goes.
 * - `exportCustomer`: the right of access and to portability, as one JSON document. No codes
 *   or access information: they are never decrypted outside the mechanic's visit.
 * - `runRetention`: what spec 10.3 says goes after its time, for every firm, every night.
 *
 * Files in storage go first and the rows after: if the database step fails, the files were due
 * anyway and the next night tries again; the other order could leave files no row points to.
 */
import { crm } from "@bojen/core/i18n/sv";
import { retentionCutoffs } from "@bojen/core/privacy";
import type { ObjectStorage } from "@bojen/core";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  accessInfo,
  attachment,
  auditLog,
  boat,
  boatOwnership,
  boatPlacement,
  call,
  consent,
  customer,
  engine,
  engineHoursReading,
  job,
  message,
  serviceReport,
  survey,
  task,
  tenant,
  verificationCode,
  visit,
  waitlistEntry,
} from "./schema";

type Db = Pick<Database, "select" | "insert" | "update" | "delete" | "execute" | "transaction">;

export interface PrivacyDeps {
  db: Db;
  storage: ObjectStorage;
  now: () => Date;
}

const texts = crm.privacy;

/** The customer's calls: by number, or who the caller said or proved to be. */
const callsOf = (tenantId: string, customerId: string) =>
  and(
    eq(call.tenantId, tenantId),
    or(
      eq(call.customerId, customerId),
      eq(call.claimedCustomerId, customerId),
      eq(call.verifiedCustomerId, customerId),
    ),
  );

/**
 * Anonymises one customer. Returns false when there is no such customer in the firm (or it is
 * already erased). `actorId` is the staff member who asked, or null for the nightly clean-up.
 */
export async function eraseCustomer(
  deps: PrivacyDeps,
  tenantId: string,
  customerId: string,
  actorId: string | null,
): Promise<boolean> {
  const { db } = deps;
  const [found] = await db
    .select({ id: customer.id, phone: customer.phone })
    .from(customer)
    .where(
      and(eq(customer.tenantId, tenantId), eq(customer.id, customerId), isNull(customer.deletedAt)),
    );
  if (!found) return false;

  // The recordings first (see the top of the file).
  const calls = await db
    .select({ id: call.id, audioKey: call.audioKey })
    .from(call)
    .where(callsOf(tenantId, customerId));
  const callIds = calls.map((c) => c.id);
  const callFiles =
    callIds.length === 0
      ? []
      : await db
          .select({ key: attachment.storageKey })
          .from(attachment)
          .where(
            and(
              eq(attachment.tenantId, tenantId),
              eq(attachment.ownerType, "call"),
              inArray(attachment.ownerId, callIds),
            ),
          );
  await deps.storage.delete([
    ...calls.flatMap((c) => (c.audioKey ? [c.audioKey] : [])),
    ...callFiles.map((f) => f.key),
  ]);

  const now = deps.now();
  await db.transaction(async (tx) => {
    await tx
      .update(customer)
      .set({
        name: texts.erasedName,
        phone: null,
        email: null,
        billingAddress: null,
        acquisitionChannel: null,
        deletedAt: now,
      })
      .where(and(eq(customer.tenantId, tenantId), eq(customer.id, customerId)));
    await tx
      .delete(consent)
      .where(and(eq(consent.tenantId, tenantId), eq(consent.customerId, customerId)));
    await tx
      .delete(waitlistEntry)
      .where(and(eq(waitlistEntry.tenantId, tenantId), eq(waitlistEntry.customerId, customerId)));
    if (found.phone) {
      await tx
        .delete(verificationCode)
        .where(
          and(eq(verificationCode.tenantId, tenantId), eq(verificationCode.phone, found.phone)),
        );
    }
    // What was said and written; the message rows stay for the counts.
    await tx
      .update(message)
      .set({
        body: null,
        subject: null,
        bodyHtml: null,
        fromAddress: null,
        toAddress: null,
        error: null,
      })
      .where(and(eq(message.tenantId, tenantId), eq(message.customerId, customerId)));
    await tx
      .update(call)
      .set({ callerNumber: null, transcript: null, summary: null, audioKey: null })
      .where(callsOf(tenantId, customerId));
    if (callIds.length > 0) {
      await tx
        .delete(attachment)
        .where(
          and(
            eq(attachment.tenantId, tenantId),
            eq(attachment.ownerType, "call"),
            inArray(attachment.ownerId, callIds),
          ),
        );
    }
    await tx
      .update(task)
      .set({ title: texts.erasedTask, note: null })
      .where(and(eq(task.tenantId, tenantId), eq(task.customerId, customerId)));
    await tx
      .update(survey)
      .set({ comment: null })
      .where(
        and(
          eq(survey.tenantId, tenantId),
          inArray(
            survey.visitId,
            tx
              .select({ id: visit.id })
              .from(visit)
              .innerJoin(job, eq(job.id, visit.jobId))
              .where(and(eq(job.tenantId, tenantId), eq(job.customerId, customerId))),
          ),
        ),
      );

    // The boats only this customer owns: what ties them to a person goes, the technical
    // history (make, model, engines, hours, places, jobs) stays.
    const owned = await tx
      .select({ boatId: boatOwnership.boatId })
      .from(boatOwnership)
      .where(and(eq(boatOwnership.tenantId, tenantId), eq(boatOwnership.customerId, customerId)));
    const boatIds: string[] = [];
    for (const { boatId } of owned) {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(boatOwnership)
        .innerJoin(customer, eq(customer.id, boatOwnership.customerId))
        .where(
          and(
            eq(boatOwnership.tenantId, tenantId),
            eq(boatOwnership.boatId, boatId),
            isNull(customer.deletedAt),
          ),
        );
      if ((others?.n ?? 0) === 0) boatIds.push(boatId);
    }
    if (boatIds.length > 0) {
      await tx
        .update(boat)
        .set({ name: null, registrationNumber: null })
        .where(and(eq(boat.tenantId, tenantId), inArray(boat.id, boatIds)));
      // The codes go with the row: without it there is nothing left to decrypt.
      await tx
        .delete(accessInfo)
        .where(and(eq(accessInfo.tenantId, tenantId), inArray(accessInfo.boatId, boatIds)));
    }

    await tx.insert(auditLog).values({
      tenantId,
      userId: actorId,
      action: "customer.erased",
      subjectType: "customer",
      subjectId: customerId,
      details: { boats: boatIds.length, calls: callIds.length },
      occurredAt: now,
    });
  });
  return true;
}

/** Everything about one customer, for a request of access or portability. */
export async function exportCustomer(
  db: Pick<Database, "select">,
  tenantId: string,
  customerId: string,
  now: Date,
) {
  const [c] = await db
    .select()
    .from(customer)
    .where(
      and(eq(customer.tenantId, tenantId), eq(customer.id, customerId), isNull(customer.deletedAt)),
    );
  if (!c) return null;

  const ownerships = await db
    .select({ boatId: boatOwnership.boatId, role: boatOwnership.role })
    .from(boatOwnership)
    .where(and(eq(boatOwnership.tenantId, tenantId), eq(boatOwnership.customerId, customerId)));
  const boatIds = ownerships.map((o) => o.boatId);
  const boats =
    boatIds.length === 0
      ? []
      : await db
          .select({
            id: boat.id,
            name: boat.name,
            make: boat.make,
            model: boat.model,
            year: boat.year,
            lengthM: boat.lengthM,
            registrationNumber: boat.registrationNumber,
          })
          .from(boat)
          .where(and(eq(boat.tenantId, tenantId), inArray(boat.id, boatIds)));
  const engines =
    boatIds.length === 0
      ? []
      : await db
          .select({
            id: engine.id,
            boatId: engine.boatId,
            make: engine.make,
            model: engine.model,
            modelYear: engine.modelYear,
            serialNumber: engine.serialNumber,
          })
          .from(engine)
          .where(and(eq(engine.tenantId, tenantId), inArray(engine.boatId, boatIds)));
  const hours =
    engines.length === 0
      ? []
      : await db
          .select({
            engineId: engineHoursReading.engineId,
            hours: engineHoursReading.hours,
            readAt: engineHoursReading.readAt,
          })
          .from(engineHoursReading)
          .where(
            and(
              eq(engineHoursReading.tenantId, tenantId),
              inArray(
                engineHoursReading.engineId,
                engines.map((e) => e.id),
              ),
            ),
          );
  const placements =
    boatIds.length === 0
      ? []
      : await db
          .select({
            boatId: boatPlacement.boatId,
            season: boatPlacement.season,
            mode: boatPlacement.mode,
            spotId: boatPlacement.spotId,
            launchDate: boatPlacement.launchDate,
            haulOutDate: boatPlacement.haulOutDate,
          })
          .from(boatPlacement)
          .where(and(eq(boatPlacement.tenantId, tenantId), inArray(boatPlacement.boatId, boatIds)));
  const access =
    boatIds.length === 0
      ? []
      : await db
          .select({ boatId: accessInfo.boatId })
          .from(accessInfo)
          .where(and(eq(accessInfo.tenantId, tenantId), inArray(accessInfo.boatId, boatIds)));

  const jobs = await db
    .select({
      id: job.id,
      boatId: job.boatId,
      status: job.pipelineStatus,
      description: job.description,
      createdAt: job.createdAt,
    })
    .from(job)
    .where(and(eq(job.tenantId, tenantId), eq(job.customerId, customerId), isNull(job.deletedAt)));
  const jobIds = jobs.map((j) => j.id);
  const visits =
    jobIds.length === 0
      ? []
      : await db
          .select({
            id: visit.id,
            jobId: visit.jobId,
            timeWindow: visit.timeWindow,
            status: visit.status,
            notes: visit.notes,
          })
          .from(visit)
          .where(and(eq(visit.tenantId, tenantId), inArray(visit.jobId, jobIds)));
  const visitIds = visits.map((v) => v.id);
  const reports =
    visitIds.length === 0
      ? []
      : await db
          .select({
            visitId: serviceReport.visitId,
            workDone: serviceReport.workDone,
            recommendations: serviceReport.recommendations,
            nextService: serviceReport.nextService,
            approvedAt: serviceReport.approvedAt,
          })
          .from(serviceReport)
          .where(
            and(eq(serviceReport.tenantId, tenantId), inArray(serviceReport.visitId, visitIds)),
          );
  const surveys =
    visitIds.length === 0
      ? []
      : await db
          .select({
            visitId: survey.visitId,
            score: survey.score,
            comment: survey.comment,
            answeredAt: survey.answeredAt,
          })
          .from(survey)
          .where(and(eq(survey.tenantId, tenantId), inArray(survey.visitId, visitIds)));

  const messages = await db
    .select({
      at: message.createdAt,
      channel: message.channel,
      direction: message.direction,
      from: message.fromAddress,
      to: message.toAddress,
      subject: message.subject,
      body: message.body,
      status: message.status,
    })
    .from(message)
    .where(and(eq(message.tenantId, tenantId), eq(message.customerId, customerId)));
  const calls = await db
    .select({
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      callerNumber: call.callerNumber,
      transcript: call.transcript,
      summary: call.summary,
      hasRecording: sql<boolean>`${call.audioKey} is not null`,
    })
    .from(call)
    .where(callsOf(tenantId, customerId));
  const consents = await db
    .select({
      type: consent.type,
      status: consent.status,
      recordedAt: consent.recordedAt,
      source: consent.source,
    })
    .from(consent)
    .where(and(eq(consent.tenantId, tenantId), eq(consent.customerId, customerId)));

  const withAccess = new Set(access.map((a) => a.boatId));
  return {
    exportedAt: now.toISOString(),
    customer: {
      name: c.name,
      type: c.type,
      phone: c.phone,
      email: c.email,
      billingAddress: c.billingAddress,
      language: c.language,
      acquisitionChannel: c.acquisitionChannel,
      createdAt: c.createdAt,
    },
    consents,
    boats: boats.map((b) => ({
      ...b,
      role: ownerships.find((o) => o.boatId === b.id)?.role ?? null,
      engines: engines
        .filter((e) => e.boatId === b.id)
        .map((e) => ({
          id: e.id,
          make: e.make,
          model: e.model,
          modelYear: e.modelYear,
          serialNumber: e.serialNumber,
          hours: hours
            .filter((h) => h.engineId === e.id)
            .map((h) => ({ hours: h.hours, readAt: h.readAt })),
        })),
      placements: placements
        .filter((p) => p.boatId === b.id)
        .map((p) => ({
          season: p.season,
          mode: p.mode,
          spotId: p.spotId,
          launchDate: p.launchDate,
          haulOutDate: p.haulOutDate,
        })),
      // That there is access information, never what it says.
      hasAccessInformation: withAccess.has(b.id),
    })),
    jobs: jobs.map((j) => ({
      ...j,
      visits: visits
        .filter((v) => v.jobId === j.id)
        .map((v) => ({
          id: v.id,
          timeWindow: v.timeWindow,
          status: v.status,
          notes: v.notes,
          report: reports.find((r) => r.visitId === v.id) ?? null,
          survey: surveys.find((s) => s.visitId === v.id) ?? null,
        })),
    })),
    messages,
    calls,
  };
}

export type CustomerExport = NonNullable<Awaited<ReturnType<typeof exportCustomer>>>;

export interface RetentionReport {
  audio: number;
  callTexts: number;
  messages: number;
  auditEntries: number;
  accessInfo: number;
  inquiries: number;
  customers: number;
}

/** One night's clean-up for every firm (spec 10.3). */
export async function runRetention(deps: PrivacyDeps): Promise<RetentionReport> {
  const report: RetentionReport = {
    audio: 0,
    callTexts: 0,
    messages: 0,
    auditEntries: 0,
    accessInfo: 0,
    inquiries: 0,
    customers: 0,
  };
  const now = deps.now();
  const firms = await deps.db
    .select({ id: tenant.id, settings: tenant.settings })
    .from(tenant)
    .where(isNull(tenant.deletedAt));
  for (const firm of firms) {
    const r = await retentionForFirm(deps, firm.id, retentionCutoffs(now, firm.settings));
    for (const key of Object.keys(report) as (keyof RetentionReport)[]) report[key] += r[key];
  }
  return report;
}

async function retentionForFirm(
  deps: PrivacyDeps,
  tenantId: string,
  cut: ReturnType<typeof retentionCutoffs>,
): Promise<RetentionReport> {
  const { db } = deps;

  // Call audio, and voicemails kept as files on the call.
  const oldAudio = await db
    .select({ id: call.id, key: call.audioKey })
    .from(call)
    .where(
      and(
        eq(call.tenantId, tenantId),
        isNotNull(call.audioKey),
        lt(call.startedAt, cut.audioBefore),
      ),
    );
  const oldFiles = await db
    .select({ id: attachment.id, key: attachment.storageKey })
    .from(attachment)
    .where(
      and(
        eq(attachment.tenantId, tenantId),
        eq(attachment.ownerType, "call"),
        lt(attachment.createdAt, cut.audioBefore),
      ),
    );
  await deps.storage.delete([
    ...oldAudio.flatMap((c) => (c.key ? [c.key] : [])),
    ...oldFiles.map((f) => f.key),
  ]);
  if (oldAudio.length > 0) {
    await db
      .update(call)
      .set({ audioKey: null })
      .where(
        inArray(
          call.id,
          oldAudio.map((c) => c.id),
        ),
      );
  }
  if (oldFiles.length > 0) {
    await db.delete(attachment).where(
      inArray(
        attachment.id,
        oldFiles.map((f) => f.id),
      ),
    );
  }

  const callTexts = await db
    .update(call)
    .set({ transcript: null, summary: null, callerNumber: null })
    .where(
      and(
        eq(call.tenantId, tenantId),
        lt(call.startedAt, cut.callTextBefore),
        or(isNotNull(call.transcript), isNotNull(call.summary), isNotNull(call.callerNumber)),
      ),
    )
    .returning({ id: call.id });

  const messages = await db
    .update(message)
    .set({
      body: null,
      subject: null,
      bodyHtml: null,
      fromAddress: null,
      toAddress: null,
      error: null,
    })
    .where(
      and(
        eq(message.tenantId, tenantId),
        lt(message.createdAt, cut.messageBefore),
        or(isNotNull(message.body), isNotNull(message.fromAddress), isNotNull(message.toAddress)),
      ),
    )
    .returning({ id: message.id });

  const audit = await db
    .delete(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), lt(auditLog.occurredAt, cut.auditBefore)))
    .returning({ id: auditLog.id });

  const access = await db
    .delete(accessInfo)
    .where(and(eq(accessInfo.tenantId, tenantId), lt(accessInfo.validUntil, cut.accessBefore)))
    .returning({ id: accessInfo.id });

  // Inquiries that never became work: no visit was ever done.
  const neverDone = sql`not exists (select 1 from ${visit} v where v.job_id = ${job.id} and v.status = 'done')`;
  const inquiries = await db
    .update(job)
    .set({ description: null, deletedAt: deps.now() })
    .where(
      and(
        eq(job.tenantId, tenantId),
        isNull(job.deletedAt),
        inArray(job.pipelineStatus, ["inquiry", "quote", "cancelled"]),
        lt(job.updatedAt, cut.inquiryBefore),
        neverDone,
      ),
    )
    .returning({ id: job.id });
  if (inquiries.length > 0) {
    await db
      .update(visit)
      .set({ notes: null, deletedAt: deps.now() })
      .where(
        and(
          eq(visit.tenantId, tenantId),
          inArray(
            visit.jobId,
            inquiries.map((j) => j.id),
          ),
        ),
      );
  }

  // Customers with nothing for 36 months: no job begun and no visit since, and nothing ahead.
  const before = cut.customerBefore.toISOString();
  const stale = await db.execute<{ id: string }>(sql`
    select c.id from ${customer} c
    where c.tenant_id = ${tenantId} and c.deleted_at is null and c.created_at < ${before}::timestamptz
      and not exists (
        select 1 from ${job} j
        where j.customer_id = c.id and j.deleted_at is null and j.created_at >= ${before}::timestamptz
      )
      and not exists (
        select 1 from ${visit} v join ${job} j on j.id = v.job_id
        where j.customer_id = c.id and v.deleted_at is null
          and upper(v.time_window) >= ${before}::timestamptz
      )
  `);
  let customers = 0;
  for (const row of stale) {
    if (await eraseCustomer(deps, tenantId, row.id, null)) customers++;
  }

  return {
    audio: oldAudio.length + oldFiles.length,
    callTexts: callTexts.length,
    messages: messages.length,
    auditEntries: audit.length,
    accessInfo: access.length,
    inquiries: inquiries.length,
    customers,
  };
}

/** The nightly clean-up's task, and when it runs: 02:00 UTC, 03:00–04:00 in Stockholm. */
export const RETENTION_TASK = "privacy_retention";
export const PRIVACY_CRONTAB = `0 2 * * * ${RETENTION_TASK}`;

/** Who exported a customer, and when (spec 10.6): the export holds everything about them. */
export async function recordExport(
  db: Pick<Database, "insert">,
  tenantId: string,
  customerId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await db.insert(auditLog).values({
    tenantId,
    userId,
    action: "customer.exported",
    subjectType: "customer",
    subjectId: customerId,
    occurredAt: now,
  });
}
