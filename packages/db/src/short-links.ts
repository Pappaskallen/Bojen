/**
 * The customer's short links and the page behind them, `/x/{code}` (byggplan step 3.4).
 *
 * The code is only ever hashed (`linkHash`), so it is looked up without knowing the firm.
 * A link opens as often as the customer likes, since link previews in messaging apps open it
 * too. Rescheduling or cancelling uses up every link of the visit; a reschedule then sends a
 * new confirmation with a new link (the worker, F1).
 */
import { randomUUID } from "node:crypto";
import {
  bookingSettings,
  cancelBy,
  customerMayChange,
  stockholmDate,
  type ObjectStorage,
  type PlacementMode,
} from "@bojen/core";
import type { Kms } from "@bojen/core/crypto";
import {
  type LinkPurpose,
  type LinkState,
  isShortCode,
  linkHash,
  linkState,
  newShortCode,
} from "@bojen/core/links";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { encryptAccess } from "./access";
import { BookingError, changeBooking, type BookingResult } from "./booking";
import { answerCampaign, recipientForVisit } from "./campaigns";
import { scheduleNameplate } from "./postcall";
import type { Database } from "./client";
import { type VisitContext, visitContext } from "./flows";
import type { SuggestRequest } from "./public-booking";
import { accessInfo, attachment, boatPlacement, job, shortLink, survey, tenant } from "./schema";

type Db = Pick<Database, "select" | "insert" | "update">;

export interface NewShortLink {
  tenantId: string;
  visitId: string;
  purpose: LinkPurpose;
  expiresAt: Date;
}

/** Stores a new link and returns its code, which exists nowhere else afterwards. */
export async function createShortLink(db: Db, key: string, link: NewShortLink): Promise<string> {
  const code = newShortCode();
  await db.insert(shortLink).values({ ...link, codeHash: linkHash(key, code) });
  return code;
}

export interface ShortLinkRow {
  id: string;
  tenantId: string;
  visitId: string;
  purpose: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/** The link behind a code, or null for a code that does not exist or is malformed. */
export async function findShortLink(
  db: Db,
  key: string,
  code: string,
): Promise<ShortLinkRow | null> {
  if (!isShortCode(code)) return null;
  const [row] = await db
    .select({
      id: shortLink.id,
      tenantId: shortLink.tenantId,
      visitId: shortLink.visitId,
      purpose: shortLink.purpose,
      expiresAt: shortLink.expiresAt,
      usedAt: shortLink.usedAt,
    })
    .from(shortLink)
    .where(and(eq(shortLink.codeHash, linkHash(key, code)), isNull(shortLink.deletedAt)));
  return row ?? null;
}

/** Uses up every link of a visit that still works; an expired one keeps saying so. */
export async function useLinksOf(db: Db, tenantId: string, visitId: string, at: Date) {
  await db
    .update(shortLink)
    .set({ usedAt: at })
    .where(
      and(
        eq(shortLink.tenantId, tenantId),
        eq(shortLink.visitId, visitId),
        isNull(shortLink.usedAt),
        gt(shortLink.expiresAt, at),
      ),
    );
}

const OPEN = new Set([
  "pending_approval",
  "tentative",
  "reserved",
  "booked",
  "confirmed",
  "unconfirmed",
]);

export type ManagePage =
  | { state: "missing" }
  | { state: Exclude<LinkState, "valid"> | "closed"; firm: VisitContext["firm"] }
  | {
      state: "valid";
      visit: VisitContext;
      /** Free rescheduling and cancellation until the firm's limit before the start. */
      mayChange: boolean;
      /** "tis 21/10 kl 12". */
      cancelBy: string;
      /** Whether access information is already stored. Never what it says. */
      hasAccess: boolean;
      /** What the time suggestions need, or null when the boat's place is unknown. */
      suggest: SuggestRequest | null;
    };

export interface LinkDeps {
  db: Db;
  now: () => Date;
  /** `SHORT_LINK_KEY`, which the codes are hashed with. */
  linkKey: string;
}

/** Where the boat is on the day of the visit, for new time suggestions. */
async function placeOf(db: Db, tenantId: string, boatId: string, start: Date) {
  const [row] = await db
    .select({
      locationId: boatPlacement.locationId,
      mode: boatPlacement.mode,
      launchDate: boatPlacement.launchDate,
      haulOutDate: boatPlacement.haulOutDate,
    })
    .from(boatPlacement)
    .where(
      and(
        eq(boatPlacement.tenantId, tenantId),
        eq(boatPlacement.boatId, boatId),
        sql`${boatPlacement.validDuring} @> ${stockholmDate(start)}::date`,
        isNull(boatPlacement.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Everything the customer page shows for a code. */
export async function managePage(deps: LinkDeps, code: string): Promise<ManagePage> {
  const link = await findShortLink(deps.db, deps.linkKey, code);
  if (!link || link.purpose !== "manage") return { state: "missing" };
  const visit = await visitContext(deps.db, link.tenantId, link.visitId);
  if (!visit) return { state: "missing" };

  const now = deps.now();
  const state = linkState(link, now);
  if (state !== "valid") return { state, firm: visit.firm };
  if (!OPEN.has(visit.status)) return { state: "closed", firm: visit.firm };

  const settings = bookingSettings(visit.firm.settings);
  const [access] = visit.boat
    ? await deps.db
        .select({ id: accessInfo.id })
        .from(accessInfo)
        .where(
          and(
            eq(accessInfo.tenantId, link.tenantId),
            eq(accessInfo.boatId, visit.boat.id),
            isNull(accessInfo.deletedAt),
            sql`(${accessInfo.codeEncrypted} is not null or ${accessInfo.keyLocationEncrypted} is not null)`,
          ),
        )
    : [];

  let suggest: SuggestRequest | null = null;
  const [jobRow] = await deps.db
    .select({ serviceTypeId: job.serviceTypeId })
    .from(job)
    .where(and(eq(job.tenantId, link.tenantId), eq(job.id, visit.jobId)));
  const place = visit.boat
    ? await placeOf(deps.db, link.tenantId, visit.boat.id, visit.start)
    : null;
  if (jobRow?.serviceTypeId && place) {
    const changeDate = place.mode === "water" ? place.haulOutDate : place.launchDate;
    suggest = {
      serviceTypeId: jobRow.serviceTypeId,
      place: { locationId: place.locationId },
      mode: place.mode as PlacementMode,
      changeDate,
      excludeVisitId: visit.visitId,
    };
  }

  return {
    state: "valid",
    visit,
    mayChange: customerMayChange(visit.start, now, settings.customerChangeCutoffHours),
    cancelBy: cancelBy(visit.start, settings.customerChangeCutoffHours),
    hasAccess: Boolean(access),
    suggest,
  };
}

/** A link that may still be used, and the customer it belongs to. */
async function usableLink(deps: LinkDeps, code: string) {
  const link = await findShortLink(deps.db, deps.linkKey, code);
  if (!link || link.purpose !== "manage") throw new BookingError("not_found", "link");
  const state = linkState(link, deps.now());
  if (state !== "valid") throw new BookingError(state === "used" ? "link_used" : "link_expired");
  const visit = await visitContext(deps.db, link.tenantId, link.visitId);
  if (!visit) throw new BookingError("not_found", "visit");
  return { link, visit };
}

export interface LinkChangeDeps extends LinkDeps {
  db: Database;
}

/**
 * Moves the visit to a new time as the customer, through the same booking rules as
 * everywhere else: the cancellation limit, a free mechanic and a time in the future. The old
 * time is free as soon as this returns.
 */
export async function rescheduleByLink(
  deps: LinkChangeDeps,
  code: string,
  input: { start: Date; mechanicId: string },
): Promise<BookingResult> {
  const { link, visit } = await usableLink(deps, code);
  const result = await changeBooking(
    deps,
    {
      tenantId: link.tenantId,
      actor: { type: "customer", id: visit.customer.id },
      idempotencyKey: `link:${link.id}:reschedule`,
    },
    link.visitId,
    { event: "reschedule", start: input.start, mechanicId: input.mechanicId },
  );
  await useLinksOf(deps.db, link.tenantId, link.visitId, deps.now());
  return result;
}

/** Cancels the visit as the customer, within the cancellation limit. */
export async function cancelByLink(deps: LinkChangeDeps, code: string): Promise<BookingResult> {
  const { link, visit } = await usableLink(deps, code);
  const result = await changeBooking(
    deps,
    {
      tenantId: link.tenantId,
      actor: { type: "customer", id: visit.customer.id },
      idempotencyKey: `link:${link.id}:cancel`,
    },
    link.visitId,
    { event: "cancel" },
  );
  await useLinksOf(deps.db, link.tenantId, link.visitId, deps.now());
  return result;
}

/**
 * JA to a campaign's held time from the e-mail's link (F11, step 5.6): booked as an sms JA
 * would be, which sends F1. A time that is not held any more cannot be taken here.
 */
export async function acceptByLink(deps: LinkChangeDeps, code: string): Promise<void> {
  const { link, visit } = await usableLink(deps, code);
  if (visit.status !== "reserved") throw new BookingError("invalid_transition", "not reserved");
  const target = await recipientForVisit(deps.db, link.tenantId, link.visitId);
  if (target) {
    if ((await answerCampaign(deps, link.tenantId, target, "yes")) !== "booked") {
      throw new BookingError("invalid_transition", "already answered");
    }
  } else {
    await changeBooking(
      deps,
      {
        tenantId: link.tenantId,
        actor: { type: "system", id: null },
        idempotencyKey: `link:${link.id}:accept`,
      },
      link.visitId,
      { event: "accept" },
    );
  }
  await useLinksOf(deps.db, link.tenantId, link.visitId, deps.now());
}

export interface AccessForm {
  code?: string;
  keyLocation?: string;
}

/** Longest code or key description the form takes. */
export const ACCESS_MAX_LENGTH = 200;

/**
 * Saves what the customer types into the access form, encrypted (step 1.6). Leaving a field
 * empty keeps what is stored. Does not use up the link, and never reads anything back.
 */
export async function saveAccessByLink(
  deps: LinkDeps & { kms: Kms },
  code: string,
  form: AccessForm,
): Promise<void> {
  const { link, visit } = await usableLink(deps, code);
  if (!visit.boat) throw new BookingError("not_found", "boat");
  const clean = (value: string | undefined) => {
    const v = value?.trim();
    if (!v) return undefined;
    if (v.length > ACCESS_MAX_LENGTH) throw new BookingError("invalid_input", "access");
    return v;
  };
  const accessCode = clean(form.code);
  const keyLocation = clean(form.keyLocation);
  if (accessCode === undefined && keyLocation === undefined) {
    throw new BookingError("invalid_input", "access");
  }
  await encryptAccess(
    { db: deps.db, kms: deps.kms, now: deps.now },
    {
      tenantId: link.tenantId,
      boatId: visit.boat.id,
      ...(accessCode === undefined ? {} : { code: accessCode }),
      ...(keyLocation === undefined ? {} : { keyLocation }),
    },
  );
}

export const LINK_PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const LINK_MAX_PICTURES = 5;
export const LINK_MAX_PICTURE_BYTES = 8 * 1024 * 1024;

/**
 * Pictures the customer sends through the link (step 6.1, for skicka_lank `bilder` and
 * `typskylt`): saved on the visit's job, where the boat card and the mechanic see them. Does
 * not use up the link.
 */
export async function addPicturesByLink(
  deps: LinkChangeDeps & { storage: ObjectStorage },
  code: string,
  pictures: { bytes: Uint8Array; contentType: string }[],
): Promise<number> {
  if (pictures.length === 0 || pictures.length > LINK_MAX_PICTURES) {
    throw new BookingError("invalid_input", "pictures");
  }
  for (const p of pictures) {
    if (
      !LINK_PICTURE_TYPES.includes(p.contentType as (typeof LINK_PICTURE_TYPES)[number]) ||
      p.bytes.byteLength === 0 ||
      p.bytes.byteLength > LINK_MAX_PICTURE_BYTES
    ) {
      throw new BookingError("invalid_input", "picture");
    }
  }
  const { link, visit } = await usableLink(deps, code);
  for (const p of pictures) {
    const ext = p.contentType.split("/")[1] ?? "bin";
    const key = `${link.tenantId}/jobs/${visit.jobId}/${randomUUID()}.${ext}`;
    await deps.storage.put(key, p.bytes, p.contentType);
    const [saved] = await deps.db
      .insert(attachment)
      .values({
        tenantId: link.tenantId,
        ownerType: "job",
        ownerId: visit.jobId,
        storageKey: key,
        contentType: p.contentType,
        sizeBytes: p.bytes.byteLength,
      })
      .returning({ id: attachment.id });
    // Each picture is read for a type plate in the worker (step 6.3).
    if (saved) await scheduleNameplate(deps.db, link.tenantId, saved.id, deps.now());
  }
  return pictures.length;
}

/**
 * The review link in F9's answer to a good score (`/r/{code}`): counts the first click on the
 * visit's survey (KPI 18) and gives the firm's review page, or null for a link that does not
 * exist, has expired or is no review link, or a firm without a review page.
 */
export async function openReviewLink(
  db: Db,
  key: string,
  code: string,
  now: Date,
): Promise<string | null> {
  const link = await findShortLink(db, key, code);
  if (link?.purpose !== "review" || linkState(link, now) !== "valid") return null;
  const [firm] = await db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, link.tenantId));
  const url = firm?.settings.reviewUrl;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
  await db
    .update(survey)
    .set({ reviewLinkClickedAt: now })
    .where(
      and(
        eq(survey.tenantId, link.tenantId),
        eq(survey.visitId, link.visitId),
        isNull(survey.reviewLinkClickedAt),
      ),
    );
  return url;
}
