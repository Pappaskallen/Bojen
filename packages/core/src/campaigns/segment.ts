/**
 * Who the spring campaign goes to (F11, byggplan step 5.6). Pure: the database gathers what
 * each boat did last year, and this says which segment it is in, or why it is left out.
 *
 * - A: a spring service last spring (March–May), and nothing booked this spring.
 * - B: laid up last autumn (September–December), but no spring service last spring.
 * - C (overdue by the service plan) waits for ServicePlan, which does not exist yet.
 *
 * Left out: a sold boat, a number that replied STOPP, a rating of 1–2 whose follow-up is
 * still open, a boat already booked this spring, and a customer with neither mobile nor
 * e-mail. Unpaid invoices are left out once invoices exist (Fortnox, step 8).
 */

export type SpringSegment = "A" | "B";
export type Exclusion = "sold" | "opted_out" | "low_rating" | "booked" | "no_contact";

export interface SpringCandidate {
  boatSold: boolean;
  /** The customer's mobile replied STOPP. */
  optedOut: boolean;
  /** A rating of 1–2 whose follow-up task is not done. */
  openLowRating: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  /** Start of last spring's spring service, if there was one. */
  lastSpring: Date | null;
  laidUpLastAutumn: boolean;
  /** A visit this spring that is not cancelled. */
  bookedThisSpring: boolean;
}

export type SegmentResult = { segment: SpringSegment } | { excluded: Exclusion } | null;

/** The segment of one boat, the reason it is left out, or null when it is in none. */
export function springSegment(c: SpringCandidate): SegmentResult {
  const segment: SpringSegment | null = c.lastSpring ? "A" : c.laidUpLastAutumn ? "B" : null;
  if (!segment) return null;
  if (c.boatSold) return { excluded: "sold" };
  if (c.bookedThisSpring) return { excluded: "booked" };
  if (c.openLowRating) return { excluded: "low_rating" };
  // Spec F11: whoever replied STOPP gets no campaign at all, not even by e-mail.
  if (c.optedOut) return { excluded: "opted_out" };
  if (!c.hasPhone && !c.hasEmail) return { excluded: "no_contact" };
  return { segment };
}

/** The spring of `year`: March to May, as Stockholm dates. */
export const springOf = (year: number) => ({
  from: `${String(year)}-03-01`,
  to: `${String(year)}-05-31`,
});

/** The autumn before the spring of `year`: September to December. */
export const autumnBefore = (year: number) => ({
  from: `${String(year - 1)}-09-01`,
  to: `${String(year - 1)}-12-31`,
});

/** Services named for spring or launch, and for laying up, as the campaign form's defaults. */
export const looksLikeSpringService = (name: string) => /vår|sjösätt/i.test(name);
export const looksLikeLayUp = (name: string) => /vinter|konserv|upptag/i.test(name);
