import {
  bookingSettings,
  dayMonth,
  firstName,
  promisedWindow,
  sv,
  weekdayShort,
} from "@bojen/core";
import { manageLinkExpiry, shortLinkUrl } from "@bojen/core/links";
import { type Database, type VisitContext, createShortLink } from "@bojen/db";

/**
 * `manage`: the booking's own page. `report`: the service report. `rebook`: the firm's
 * booking page, for a new time after a cancelled visit.
 */
export type LinkUse = "manage" | "report" | "rebook";

/** What every flow needs. The clock is injected, so tests run the flows at any time. */
export interface FlowDeps {
  db: Database;
  now: () => Date;
  /** `SMS_OPT_OUT_KEY`, for the STOPP list. */
  optOutKey: string;
  /** The customer's link for a visit, as written in the sms. */
  link: (visit: VisitContext, purpose: LinkUse) => string | Promise<string>;
}

/**
 * The links in the flows (step 3.4): `manage` is a new short link, `bojen.se/x/{code}`, valid
 * until the visit starts. The report has no page of its own yet, so `report` is still the
 * firm's booking page.
 */
export function customerLinks(db: Database, linkKey: string, base: string) {
  const page = bookingPageLink(base);
  return async (visit: VisitContext, purpose: LinkUse) => {
    if (purpose !== "manage") return page(visit);
    const code = await createShortLink(db, linkKey, {
      tenantId: visit.tenantId,
      visitId: visit.visitId,
      purpose,
      expiresAt: manageLinkExpiry(visit.start),
    });
    return shortLinkUrl(base, code);
  };
}

/** The firm's booking page, where the customer can book again. */
export function bookingPageLink(base: string) {
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return (visit: VisitContext) => `${host}/boka/${visit.firm.slug ?? ""}`;
}

const unknown = sv.flows.unknown;
const or = (value: string | null | undefined) => (value && value.trim() !== "" ? value : unknown);

/** The boat as the sms name it: its name, else make and model. */
export function boatLabel(visit: VisitContext): string {
  const b = visit.boat;
  if (b?.name) return b.name;
  const makeModel = [b?.make, b?.model].filter(Boolean).join(" ");
  return makeModel || "båten";
}

/** The values many templates share, filled in for a visit. */
export function visitVars(visit: VisitContext) {
  const settings = bookingSettings(visit.firm.settings);
  return {
    firm: visit.firm.name,
    firstName: firstName(visit.customer.name),
    serviceShort: or(visit.service?.name),
    service: or(visit.service?.name),
    weekday: weekdayShort(visit.start),
    date: dayMonth(visit.start),
    window: promisedWindow(visit.start, visit.end, settings.windows),
    placeShort: or(visit.place?.name),
    placeName: or(visit.place?.name),
    placeDetail: or(
      [visit.place?.spotId ? `plats ${visit.place.spotId}` : null, visit.place?.address]
        .filter(Boolean)
        .join(", "),
    ),
    mode: visit.place ? (sv.flows.mode[visit.place.mode as "water"] ?? unknown) : unknown,
    boat: boatLabel(visit),
    boatMake: or(visit.boat?.make),
    boatModel: or(visit.boat?.model),
    engineMake: or(visit.engine?.make),
    engineModel: or(visit.engine?.model),
    mechanicName: or(visit.mechanic?.name),
    mechanicFirstName: visit.mechanic ? firstName(visit.mechanic.name) : visit.firm.name,
    phone: or(visit.firm.phone),
  };
}
