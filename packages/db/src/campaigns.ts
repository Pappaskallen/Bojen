/**
 * The spring campaign (F11, byggplan step 5.6): who it goes to, the times it holds, and how
 * it went. The sending itself is the worker's (apps/worker/src/flows/campaign.ts); the rules
 * are in packages/core/src/campaigns.
 */
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_TARGET_WEEK,
  autumnBefore,
  chooseSlot,
  nextSendAt,
  springOf,
  springSegment,
  targetWeek,
  type Exclusion,
  type MapsProvider,
  type PlacementMode,
  type SpringSegment,
  type TargetWeek,
} from "@bojen/core";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { BookingError, changeBooking, createBooking } from "./booking";
import type { Database } from "./client";
import { isOptedOut, scheduleJob } from "./messaging";
import { publicSuggestions } from "./public-booking";
import {
  boat,
  boatPlacement,
  campaign,
  campaignRecipient,
  serviceReport,
  visit,
  job,
} from "./schema";

type Db = Pick<Database, "select" | "insert" | "update" | "execute" | "transaction">;

export const CAMPAIGN_ROUND_TASK = "campaign_round";
export const CAMPAIGN_RELEASE_TASK = "campaign_release";

export class CampaignError extends Error {
  constructor(readonly code: "not_found" | "invalid_input" | "wrong_state") {
    super(code);
    this.name = "CampaignError";
  }
}

/** What the spring campaign is set to: stored in `campaign.segment_rules`. */
export interface SpringRules {
  kind: "spring";
  /** The spring the times are held in, for example 2027. */
  year: number;
  /** Which services count as last year's spring service, and as last autumn's lay-up. */
  springServiceIds: string[];
  layUpServiceIds: string[];
  /** The service booked when the customer says JA. */
  bookServiceTypeId: string;
  batchSize: number;
  /** The week for a boat with no visit last spring and no launch date. */
  defaultWeek: number;
}

export function springRules(raw: unknown): SpringRules | null {
  const r = (raw ?? {}) as Partial<SpringRules>;
  if (r.kind !== "spring" || typeof r.year !== "number" || typeof r.bookServiceTypeId !== "string")
    return null;
  return {
    kind: "spring",
    year: r.year,
    springServiceIds: Array.isArray(r.springServiceIds) ? r.springServiceIds : [],
    layUpServiceIds: Array.isArray(r.layUpServiceIds) ? r.layUpServiceIds : [],
    bookServiceTypeId: r.bookServiceTypeId,
    batchSize:
      typeof r.batchSize === "number" && r.batchSize > 0 ? r.batchSize : DEFAULT_BATCH_SIZE,
    defaultWeek:
      typeof r.defaultWeek === "number" && r.defaultWeek >= 1 && r.defaultWeek <= 52
        ? r.defaultWeek
        : DEFAULT_TARGET_WEEK,
  };
}

export interface SpringBoat {
  boatId: string;
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  lastSpring: Date | null;
  laidUpLastAutumn: boolean;
  result: { segment: SpringSegment } | { excluded: Exclusion } | null;
}

const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

/**
 * Every boat of the firm with its owner, what it had done last year, and which segment that
 * puts it in (or why it is left out). `boatIds` narrows it to some boats.
 */
export async function springBoats(
  deps: { db: Db; optOutKey: string },
  tenantId: string,
  rules: Pick<SpringRules, "year" | "springServiceIds" | "layUpServiceIds">,
  boatIds?: readonly string[],
): Promise<SpringBoat[]> {
  const last = springOf(rules.year - 1);
  const autumn = autumnBefore(rules.year);
  const coming = springOf(rules.year);
  const day = sql`(lower(v.time_window) at time zone 'Europe/Stockholm')::date`;
  const rows = (await deps.db.execute(sql`
    select b.id as "boatId", b.status as "boatStatus",
           c.id as "customerId", c.name as "customerName", c.phone, c.email,
           (select max(lower(v.time_window)) from visit v
              join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
             where j.tenant_id = b.tenant_id and j.boat_id = b.id and j.deleted_at is null
               and v.deleted_at is null and v.status = 'done'
               and j.service_type_id = any(${uuids(rules.springServiceIds)})
               and ${day} between ${last.from}::date and ${last.to}::date) as "lastSpring",
           exists (select 1 from visit v
              join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
             where j.tenant_id = b.tenant_id and j.boat_id = b.id and j.deleted_at is null
               and v.deleted_at is null and v.status = 'done'
               and j.service_type_id = any(${uuids(rules.layUpServiceIds)})
               and ${day} between ${autumn.from}::date and ${autumn.to}::date) as "laidUp",
           exists (select 1 from visit v
              join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
             where j.tenant_id = b.tenant_id and j.boat_id = b.id and j.deleted_at is null
               and v.deleted_at is null and v.status <> 'cancelled'
               and ${day} between ${coming.from}::date and ${coming.to}::date) as "booked",
           exists (select 1 from task t
             where t.tenant_id = b.tenant_id and t.customer_id = c.id and t.type = 'low_csat'
               and t.status = 'open' and t.deleted_at is null) as "lowRating"
      from boat b
      join lateral (select bo.customer_id from boat_ownership bo
                     where bo.tenant_id = b.tenant_id and bo.boat_id = b.id
                       and bo.role = 'owner' and bo.deleted_at is null
                     order by bo.created_at limit 1) o on true
      join customer c on c.tenant_id = b.tenant_id and c.id = o.customer_id and c.deleted_at is null
     where b.tenant_id = ${tenantId} and b.deleted_at is null
       ${boatIds ? sql`and b.id = any(${uuids(boatIds)})` : sql``}
     order by b.created_at
  `)) as unknown as {
    boatId: string;
    boatStatus: string;
    customerId: string;
    customerName: string;
    phone: string | null;
    email: string | null;
    lastSpring: string | Date | null;
    laidUp: boolean;
    booked: boolean;
    lowRating: boolean;
  }[];

  const out: SpringBoat[] = [];
  for (const r of rows) {
    const lastSpring = r.lastSpring ? new Date(r.lastSpring) : null;
    const optedOut = r.phone ? await isOptedOut(deps.db, deps.optOutKey, tenantId, r.phone) : false;
    out.push({
      boatId: r.boatId,
      customerId: r.customerId,
      customerName: r.customerName,
      phone: r.phone,
      email: r.email,
      lastSpring,
      laidUpLastAutumn: r.laidUp,
      result: springSegment({
        boatSold: r.boatStatus === "sold",
        optedOut,
        openLowRating: r.lowRating,
        hasPhone: Boolean(r.phone),
        hasEmail: Boolean(r.email),
        lastSpring,
        laidUpLastAutumn: r.laidUp,
        bookedThisSpring: r.booked,
      }),
    });
  }
  return out;
}

/** How many boats each segment has, and how many are left out and why: the form's preview. */
export function segmentCounts(boats: readonly SpringBoat[]) {
  const counts = { A: 0, B: 0, excluded: {} as Partial<Record<Exclusion, number>> };
  for (const b of boats) {
    if (!b.result) continue;
    if ("segment" in b.result) counts[b.result.segment]++;
    else counts.excluded[b.result.excluded] = (counts.excluded[b.result.excluded] ?? 0) + 1;
  }
  return counts;
}

export interface NewSpringCampaign {
  name: string;
  year: number;
  scheduledAt: Date;
  springServiceIds: string[];
  layUpServiceIds: string[];
  bookServiceTypeId: string;
  batchSize?: number;
  defaultWeek?: number;
  discountPercent?: number | null;
}

/** A spring campaign as a draft; nothing is sent until it is started. */
export async function createSpringCampaign(
  db: Db,
  tenantId: string,
  input: NewSpringCampaign,
): Promise<string> {
  const name = input.name.trim();
  if (
    !name ||
    name.length > 120 ||
    !Number.isInteger(input.year) ||
    input.springServiceIds.length + input.layUpServiceIds.length === 0 ||
    (input.discountPercent !== undefined &&
      input.discountPercent !== null &&
      !(input.discountPercent > 0 && input.discountPercent <= 50))
  ) {
    throw new CampaignError("invalid_input");
  }
  const rules: SpringRules = {
    kind: "spring",
    year: input.year,
    springServiceIds: input.springServiceIds,
    layUpServiceIds: input.layUpServiceIds,
    bookServiceTypeId: input.bookServiceTypeId,
    batchSize: input.batchSize ?? DEFAULT_BATCH_SIZE,
    defaultWeek: input.defaultWeek ?? DEFAULT_TARGET_WEEK,
  };
  const [row] = await db
    .insert(campaign)
    .values({
      tenantId,
      name,
      segmentRules: rules,
      templates: { sms: { A: "f11_spring_a", B: "f11_spring_b" }, email: "f11_spring" },
      discountPercent: input.discountPercent ? String(input.discountPercent) : null,
      suggestedVisitRule: { kind: "same_week_last_year" },
      scheduledAt: input.scheduledAt,
    })
    .returning({ id: campaign.id });
  if (!row) throw new Error("campaign not created");
  return row.id;
}

async function campaignRow(db: Db, tenantId: string, campaignId: string) {
  const [row] = await db
    .select()
    .from(campaign)
    .where(
      and(eq(campaign.tenantId, tenantId), eq(campaign.id, campaignId), isNull(campaign.deletedAt)),
    );
  if (!row) throw new CampaignError("not_found");
  const rules = springRules(row.segmentRules);
  if (!rules) throw new CampaignError("invalid_input");
  return { ...row, rules };
}

/**
 * Starts a draft: every boat in segment A or B becomes a recipient, and the first round is
 * put in for the first Tuesday–Thursday 18:30 from the campaign's time.
 */
export async function startCampaign(
  deps: { db: Db; now: () => Date; optOutKey: string },
  tenantId: string,
  campaignId: string,
): Promise<{ recipients: number; firstRound: Date }> {
  const c = await campaignRow(deps.db, tenantId, campaignId);
  if (c.status !== "draft") throw new CampaignError("wrong_state");
  const boats = await springBoats(deps, tenantId, c.rules);
  const chosen = boats.flatMap((b) =>
    b.result && "segment" in b.result ? [{ boat: b, segment: b.result.segment }] : [],
  );
  const now = deps.now();
  const firstRound = nextSendAt(c.scheduledAt && c.scheduledAt > now ? c.scheduledAt : now);
  await deps.db.transaction(async (tx) => {
    if (chosen.length > 0) {
      await tx
        .insert(campaignRecipient)
        .values(
          chosen.map(({ boat: b, segment }) => ({
            tenantId,
            campaignId,
            customerId: b.customerId,
            boatId: b.boatId,
            segment,
          })),
        )
        .onConflictDoNothing();
    }
    await tx
      .update(campaign)
      .set({ status: "scheduled" })
      .where(and(eq(campaign.tenantId, tenantId), eq(campaign.id, campaignId)));
    await scheduleJob(
      tx,
      CAMPAIGN_ROUND_TASK,
      { tenantId, campaignId },
      firstRound,
      `campaign:${campaignId}`,
    );
  });
  return { recipients: chosen.length, firstRound };
}

/** Where the boat is on a day: its place and mode, and the day that changes, if any. */
async function boatPlaceOn(db: Db, tenantId: string, boatId: string, day: string) {
  const [p] = await db
    .select({
      locationId: boatPlacement.locationId,
      mode: boatPlacement.mode,
      season: boatPlacement.season,
      launchDate: boatPlacement.launchDate,
      haulOutDate: boatPlacement.haulOutDate,
    })
    .from(boatPlacement)
    .where(
      and(
        eq(boatPlacement.tenantId, tenantId),
        eq(boatPlacement.boatId, boatId),
        isNull(boatPlacement.deletedAt),
        sql`${boatPlacement.validDuring} @> ${day}::date`,
      ),
    )
    .limit(1);
  return p ?? null;
}

/** The boat's launch date this spring, from its winter place. */
async function launchDateOf(db: Db, tenantId: string, boatId: string, year: number) {
  const [p] = await db
    .select({ launchDate: boatPlacement.launchDate })
    .from(boatPlacement)
    .where(
      and(
        eq(boatPlacement.tenantId, tenantId),
        eq(boatPlacement.boatId, boatId),
        eq(boatPlacement.season, "winter"),
        isNull(boatPlacement.deletedAt),
        sql`extract(year from ${boatPlacement.launchDate}) = ${year}`,
      ),
    )
    .limit(1);
  return p?.launchDate ?? null;
}

export interface RoundRecipient {
  recipientId: string;
  customerId: string;
  boatId: string;
  segment: SpringSegment;
  phone: string | null;
  email: string | null;
  target: TargetWeek;
  locationId: string | null;
  mode: PlacementMode | null;
  changeDate: string | null;
}

/**
 * The recipients still to be sent to, each with the week to hold a time in and where the
 * boat is then. Boats that have since been sold, booked or opted out are taken off the list.
 */
export async function pendingRecipients(
  deps: { db: Db; optOutKey: string },
  tenantId: string,
  campaignId: string,
): Promise<{ rules: SpringRules; discountPercent: number | null; recipients: RoundRecipient[] }> {
  const c = await campaignRow(deps.db, tenantId, campaignId);
  const rows = await deps.db
    .select({ id: campaignRecipient.id, boatId: campaignRecipient.boatId })
    .from(campaignRecipient)
    .where(
      and(
        eq(campaignRecipient.tenantId, tenantId),
        eq(campaignRecipient.campaignId, campaignId),
        eq(campaignRecipient.status, "pending"),
        isNull(campaignRecipient.problem),
        isNull(campaignRecipient.deletedAt),
      ),
    );
  const boatIds = rows.flatMap((r) => (r.boatId ? [r.boatId] : []));
  const boats = boatIds.length > 0 ? await springBoats(deps, tenantId, c.rules, boatIds) : [];

  const recipients: RoundRecipient[] = [];
  for (const r of rows) {
    const b = boats.find((x) => x.boatId === r.boatId);
    if (!b || !b.result || !("segment" in b.result)) {
      // No longer in the campaign: sold, booked meanwhile or opted out.
      await deps.db
        .update(campaignRecipient)
        .set({ problem: b?.result && "excluded" in b.result ? b.result.excluded : "left" })
        .where(eq(campaignRecipient.id, r.id));
      continue;
    }
    const launchDate = await launchDateOf(deps.db, tenantId, b.boatId, c.rules.year);
    const target = targetWeek({
      year: c.rules.year,
      lastSpring: b.lastSpring,
      launchDate,
      defaultWeek: c.rules.defaultWeek,
    });
    const place = await boatPlaceOn(deps.db, tenantId, b.boatId, target.monday);
    const change =
      place?.season === "winter"
        ? place.launchDate
        : place?.season === "summer"
          ? place.haulOutDate
          : null;
    recipients.push({
      recipientId: r.id,
      customerId: b.customerId,
      boatId: b.boatId,
      segment: b.result.segment,
      phone: b.phone,
      email: b.email,
      target,
      locationId: place?.locationId ?? null,
      mode: place?.mode ?? null,
      changeDate: change && change > target.monday ? change : null,
    });
  }
  return {
    rules: c.rules,
    discountPercent: c.discountPercent ? Number(c.discountPercent) : null,
    recipients,
  };
}

/**
 * Holds a time for the recipient in the target week: the booking engine's free times, a
 * marina day first. The visit is `reserved` until the customer answers. Null when the week
 * has no free time; the recipient is then marked so, and nothing is sent.
 */
export async function holdTime(
  deps: { db: Db; maps: MapsProvider; now: () => Date },
  tenantId: string,
  campaignId: string,
  rules: SpringRules,
  r: RoundRecipient,
): Promise<string | null> {
  const noSlot = async () => {
    await deps.db
      .update(campaignRecipient)
      .set({ problem: "no_slot" })
      .where(eq(campaignRecipient.id, r.recipientId));
    return null;
  };
  if (!r.locationId || !r.mode) return noSlot();
  const options = await publicSuggestions(deps, tenantId, {
    serviceTypeId: rules.bookServiceTypeId,
    place: { locationId: r.locationId },
    mode: r.mode,
    changeDate: r.changeDate,
    earliest: r.target.monday,
    horizonDays: 5,
    limit: 25,
  });
  const ranked = options.map((o) => ({ ...o, start: new Date(o.start) }));
  // Try the best time first; if someone took it meanwhile, the next.
  while (ranked.length > 0) {
    const best = chooseSlot(ranked, r.target);
    if (!best) break;
    ranked.splice(ranked.indexOf(best), 1);
    try {
      const booked = await createBooking(
        { db: deps.db, now: deps.now },
        {
          tenantId,
          actor: { type: "system", id: null },
          idempotencyKey: `campaign:${campaignId}:${r.boatId}`,
        },
        {
          customerId: r.customerId,
          boatId: r.boatId,
          serviceTypeId: rules.bookServiceTypeId,
          mechanicId: best.mechanicId,
          start: best.start,
          channel: "campaign",
          needsApproval: false,
          partsMissing: false,
          reserved: true,
        },
      );
      return booked.visit.id;
    } catch (error) {
      if (error instanceof BookingError && error.code === "conflict") continue;
      throw error;
    }
  }
  return noSlot();
}

/** The recipient got the message about the held time; it is released after 14 days. */
export async function markSent(
  db: Db,
  tenantId: string,
  recipientId: string,
  visitId: string,
  at: Date,
  releaseAt: Date,
) {
  await db
    .update(campaignRecipient)
    .set({ status: "sent", sentAt: at, suggestedVisitId: visitId })
    .where(and(eq(campaignRecipient.tenantId, tenantId), eq(campaignRecipient.id, recipientId)));
  await scheduleJob(
    db,
    CAMPAIGN_RELEASE_TASK,
    { tenantId, recipientId },
    releaseAt,
    `campaign-release:${recipientId}`,
  );
}

/** After a round: the next one, or the campaign is sent when nobody is left. */
export async function afterRound(
  db: Db,
  tenantId: string,
  campaignId: string,
  left: number,
  now: Date,
) {
  await db
    .update(campaign)
    .set({ status: left > 0 ? "sending" : "done" })
    .where(and(eq(campaign.tenantId, tenantId), eq(campaign.id, campaignId)));
  if (left > 0) {
    await scheduleJob(
      db,
      CAMPAIGN_ROUND_TASK,
      { tenantId, campaignId },
      nextSendAt(new Date(now.getTime() + 60_000)),
      `campaign:${campaignId}`,
    );
  }
}

export interface CampaignAnswerTarget {
  recipientId: string;
  campaignId: string;
  customerId: string;
  boatId: string | null;
  visitId: string;
  status: string;
}

/** The recipient a held time belongs to, while it waits for an answer. */
export async function recipientForVisit(
  db: Db,
  tenantId: string,
  visitId: string,
): Promise<CampaignAnswerTarget | null> {
  const [r] = await db
    .select({
      recipientId: campaignRecipient.id,
      campaignId: campaignRecipient.campaignId,
      customerId: campaignRecipient.customerId,
      boatId: campaignRecipient.boatId,
      status: campaignRecipient.status,
    })
    .from(campaignRecipient)
    .where(
      and(
        eq(campaignRecipient.tenantId, tenantId),
        eq(campaignRecipient.suggestedVisitId, visitId),
        isNull(campaignRecipient.deletedAt),
      ),
    );
  return r ? { ...r, visitId } : null;
}

const systemCtx = (tenantId: string, key: string) => ({
  tenantId,
  actor: { type: "system" as const, id: null },
  idempotencyKey: key,
});

/**
 * The answer to the held time. JA books it (the visit becomes `booked`, which sends F1),
 * ANNAN and NEJ release it. Only the first answer counts; a later one changes nothing.
 */
export async function answerCampaign(
  deps: { db: Db; now: () => Date },
  tenantId: string,
  target: CampaignAnswerTarget,
  answer: "yes" | "other" | "no",
): Promise<"booked" | "released" | "ignored"> {
  if (target.status !== "sent") return "ignored";
  const now = deps.now();
  if (answer === "yes") {
    try {
      await changeBooking(
        { db: deps.db, now: deps.now },
        systemCtx(tenantId, `campaign-accept:${target.visitId}`),
        target.visitId,
        { event: "accept", reason: "campaign_yes" },
      );
    } catch (error) {
      // Released meanwhile, or already booked: nothing to do.
      if (error instanceof BookingError && error.code === "invalid_transition") return "ignored";
      throw error;
    }
  } else {
    await release(deps, tenantId, target.visitId, `campaign_${answer}`);
  }
  await deps.db
    .update(campaignRecipient)
    .set({
      status: answer === "yes" ? "booked" : answer === "no" ? "declined" : "sent",
      answer,
      respondedAt: now,
    })
    .where(eq(campaignRecipient.id, target.recipientId));
  return answer === "yes" ? "booked" : "released";
}

async function release(
  deps: { db: Db; now: () => Date },
  tenantId: string,
  visitId: string,
  reason: string,
) {
  try {
    await changeBooking(
      { db: deps.db, now: deps.now },
      systemCtx(tenantId, `campaign-release:${visitId}`),
      visitId,
      { event: "cancel", reason },
    );
  } catch (error) {
    if (error instanceof BookingError && error.code === "invalid_transition") return;
    throw error;
  }
}

/** Fourteen days without an answer: the held time goes back to the calendar. */
export async function releaseUnanswered(
  deps: { db: Db; now: () => Date },
  tenantId: string,
  recipientId: string,
): Promise<"released" | "skipped"> {
  const [r] = await deps.db
    .select({
      status: campaignRecipient.status,
      answer: campaignRecipient.answer,
      visitId: campaignRecipient.suggestedVisitId,
    })
    .from(campaignRecipient)
    .where(and(eq(campaignRecipient.tenantId, tenantId), eq(campaignRecipient.id, recipientId)));
  if (!r?.visitId || r.status !== "sent" || r.answer) return "skipped";
  await release(deps, tenantId, r.visitId, "campaign_released");
  await deps.db
    .update(campaignRecipient)
    .set({ status: "no_reply" })
    .where(eq(campaignRecipient.id, recipientId));
  return "released";
}

/** SÅLD to the question after NEJ: the boat is marked sold and gets no more campaigns. */
export async function markBoatSold(db: Db, tenantId: string, visitId: string) {
  const [v] = await db
    .select({ boatId: job.boatId })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(and(eq(visit.tenantId, tenantId), eq(visit.id, visitId)));
  if (!v?.boatId) return false;
  await db
    .update(boat)
    .set({ status: "sold" })
    .where(and(eq(boat.tenantId, tenantId), eq(boat.id, v.boatId)));
  await db
    .update(campaignRecipient)
    .set({ answer: "sold" })
    .where(
      and(
        eq(campaignRecipient.tenantId, tenantId),
        eq(campaignRecipient.suggestedVisitId, visitId),
      ),
    );
  return true;
}

/** The open recommendations of the boat's latest approved report, for the e-mail. */
export async function openRecommendations(db: Db, tenantId: string, boatId: string) {
  const [r] = await db
    .select({ recommendations: serviceReport.recommendations })
    .from(serviceReport)
    .innerJoin(
      visit,
      and(eq(visit.tenantId, serviceReport.tenantId), eq(visit.id, serviceReport.visitId)),
    )
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(
      and(
        eq(serviceReport.tenantId, tenantId),
        eq(job.boatId, boatId),
        eq(serviceReport.status, "approved"),
      ),
    )
    .orderBy(desc(serviceReport.approvedAt))
    .limit(1);
  return (r?.recommendations ?? []).map((x) => x.text);
}

// --- The campaign pages -----------------------------------------------------------------

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  year: number | null;
  scheduledAt: Date | null;
  recipients: number;
  sent: number;
  booked: number;
  declined: number;
  noReply: number;
  otherTime: number;
  waiting: number;
  noSlot: number;
}

async function counts(db: Db, tenantId: string, campaignIds: readonly string[]) {
  if (campaignIds.length === 0)
    return new Map<
      string,
      Omit<CampaignSummary, "id" | "name" | "status" | "year" | "scheduledAt">
    >();
  const rows = await db
    .select({
      campaignId: campaignRecipient.campaignId,
      recipients: sql<number>`count(*) filter (where ${campaignRecipient.problem} is null or ${campaignRecipient.sentAt} is not null)::int`,
      sent: sql<number>`count(*) filter (where ${campaignRecipient.sentAt} is not null)::int`,
      booked: sql<number>`count(*) filter (where ${campaignRecipient.status} = 'booked')::int`,
      declined: sql<number>`count(*) filter (where ${campaignRecipient.status} = 'declined')::int`,
      noReply: sql<number>`count(*) filter (where ${campaignRecipient.status} = 'no_reply')::int`,
      otherTime: sql<number>`count(*) filter (where ${campaignRecipient.answer} = 'other')::int`,
      waiting: sql<number>`count(*) filter (where ${campaignRecipient.status} = 'sent' and ${campaignRecipient.answer} is null)::int`,
      noSlot: sql<number>`count(*) filter (where ${campaignRecipient.problem} = 'no_slot')::int`,
    })
    .from(campaignRecipient)
    .where(
      and(
        eq(campaignRecipient.tenantId, tenantId),
        inArray(campaignRecipient.campaignId, [...campaignIds]),
        isNull(campaignRecipient.deletedAt),
      ),
    )
    .groupBy(campaignRecipient.campaignId);
  return new Map(rows.map((r) => [r.campaignId, r]));
}

const empty = {
  recipients: 0,
  sent: 0,
  booked: 0,
  declined: 0,
  noReply: 0,
  otherTime: 0,
  waiting: 0,
  noSlot: 0,
};

/** The firm's campaigns, newest first, with how far each has come. */
export async function campaignList(db: Db, tenantId: string): Promise<CampaignSummary[]> {
  const rows = await db
    .select()
    .from(campaign)
    .where(and(eq(campaign.tenantId, tenantId), isNull(campaign.deletedAt)))
    .orderBy(desc(campaign.createdAt));
  const byId = await counts(
    db,
    tenantId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    year: springRules(r.segmentRules)?.year ?? null,
    scheduledAt: r.scheduledAt,
    ...(byId.get(r.id) ?? empty),
  }));
}

export interface CampaignDetail extends CampaignSummary {
  rules: SpringRules;
  discountPercent: number | null;
  /** Boats with a spring visit booked by now this year, and last year by the same date. */
  prebooked: { thisYear: number; lastYear: number };
  recipientRows: {
    id: string;
    customerName: string;
    segment: string | null;
    status: string;
    answer: string | null;
    problem: string | null;
    heldStart: Date | null;
  }[];
}

/**
 * One campaign: its numbers, every recipient, and the share of boats booked for spring by
 * today compared with the same day last year (the pre-booking rate).
 */
export async function campaignDetail(
  db: Db,
  tenantId: string,
  campaignId: string,
  now: Date,
): Promise<CampaignDetail> {
  const c = await campaignRow(db, tenantId, campaignId);
  const n = (await counts(db, tenantId, [campaignId])).get(campaignId) ?? empty;
  const recipientRows = (await db.execute(sql`
    select r.id, cu.name as "customerName", r.segment, r.status, r.answer, r.problem,
           lower(v.time_window) as "heldStart"
      from campaign_recipient r
      join customer cu on cu.tenant_id = r.tenant_id and cu.id = r.customer_id
      left join visit v on v.tenant_id = r.tenant_id and v.id = r.suggested_visit_id
     where r.tenant_id = ${tenantId} and r.campaign_id = ${campaignId} and r.deleted_at is null
     order by lower(v.time_window) nulls last, cu.name
  `)) as unknown as CampaignDetail["recipientRows"];

  // Pre-booking: boats with a spring visit (not cancelled) made by this day of the year.
  const prebookedBy = async (year: number, by: Date) => {
    const season = springOf(year);
    const [row] = (await db.execute(sql`
      select count(distinct j.boat_id)::int as n
        from visit v join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
       where v.tenant_id = ${tenantId} and v.deleted_at is null and j.boat_id is not null
         and v.status not in ('cancelled', 'reserved')
         and (lower(v.time_window) at time zone 'Europe/Stockholm')::date
             between ${season.from}::date and ${season.to}::date
         and v.created_at <= ${by.toISOString()}::timestamptz
    `)) as unknown as { n: number }[];
    return row?.n ?? 0;
  };
  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    year: c.rules.year,
    scheduledAt: c.scheduledAt,
    ...n,
    rules: c.rules,
    discountPercent: c.discountPercent ? Number(c.discountPercent) : null,
    prebooked: {
      thisYear: await prebookedBy(c.rules.year, now),
      lastYear: await prebookedBy(c.rules.year - 1, yearAgo),
    },
    recipientRows: recipientRows.map((r) => ({
      ...r,
      heldStart: r.heldStart ? new Date(r.heldStart) : null,
    })),
  };
}
