/**
 * Which question a reply by sms answers (byggplan step 3.2): the newest question to the
 * same number from the same firm that is still open. A question closes when it has been
 * answered or when its time is up, so a reply never lands on an old visit.
 */
import type { SmsTemplateKey } from "./templates";

export type QuestionKind =
  /** F3: is the boat there? JA, NEJ or ÄNDRA. */
  | "availability_check"
  /** F3 after NEJ: "svara NY så ringer vi dig". */
  | "rebook_offer"
  /** F4: a free time from the waiting list, JA within an hour. */
  | "waitlist_offer"
  /** F9: a score 1–5. */
  | "survey"
  /** F10–F12: a reserved time, JA, ANNAN or NEJ. */
  | "campaign"
  /** F11 after NEJ: "Har du sålt båten? Svara SÅLD". */
  | "sold_question"
  /** F12: which day the boat is hauled out. */
  | "haulout_question"
  /** F14: a new time offered, JA or ANNAN. */
  | "time_offer"
  /** No open question. */
  | "none";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The templates that ask something, what they ask and how long the answer is awaited. */
export const QUESTIONS: Partial<
  Record<SmsTemplateKey, { kind: Exclude<QuestionKind, "none">; openFor: number | "until_visit" }>
> = {
  f3_check_water: { kind: "availability_check", openFor: "until_visit" },
  f3_check_water_code: { kind: "availability_check", openFor: "until_visit" },
  f3_check_land: { kind: "availability_check", openFor: "until_visit" },
  f3_check_land_code: { kind: "availability_check", openFor: "until_visit" },
  f3_reminder: { kind: "availability_check", openFor: "until_visit" },
  f3_reply_no: { kind: "rebook_offer", openFor: 7 * DAY },
  f4_offer: { kind: "waitlist_offer", openFor: HOUR },
  f9_survey: { kind: "survey", openFor: 7 * DAY },
  f10_next_season: { kind: "campaign", openFor: 14 * DAY },
  f11_spring_a: { kind: "campaign", openFor: 14 * DAY },
  f11_spring_discount: { kind: "campaign", openFor: 14 * DAY },
  f11_spring_b: { kind: "campaign", openFor: 14 * DAY },
  f11_sold_question: { kind: "sold_question", openFor: 14 * DAY },
  f12_autumn: { kind: "campaign", openFor: 14 * DAY },
  f12_haulout_question: { kind: "haulout_question", openFor: 14 * DAY },
  f14_none_available: { kind: "time_offer", openFor: 2 * DAY },
  f14_moved: { kind: "time_offer", openFor: 2 * DAY },
};

/** The question templates, for finding candidates in the message log. */
export const QUESTION_TEMPLATES = Object.keys(QUESTIONS) as SmsTemplateKey[];

/** A question sent to the number, as the message log has it. */
export interface SentQuestion {
  id: string;
  template: string;
  sentAt: Date;
  /** Start of the visit the question is about, if any. */
  visitStart: Date | null;
  /** A reply has already been linked to it. */
  answered: boolean;
}

/** When the question stops waiting for an answer. */
export function closesAt(question: Pick<SentQuestion, "template" | "sentAt" | "visitStart">): Date {
  const info = QUESTIONS[question.template as SmsTemplateKey];
  if (!info) return question.sentAt;
  if (info.openFor === "until_visit") return question.visitStart ?? question.sentAt;
  return new Date(question.sentAt.getTime() + info.openFor);
}

export function isOpen(question: SentQuestion, now: Date): boolean {
  if (question.answered || question.sentAt > now) return false;
  return now < closesAt(question);
}

/** The question a reply at `now` answers, with its kind; "none" when no question is open. */
export function routeInbound(
  questions: SentQuestion[],
  now: Date,
): { question: SentQuestion | null; kind: QuestionKind } {
  const open = questions
    .filter((q) => isOpen(q, now))
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const newest = open[0];
  if (!newest) return { question: null, kind: "none" };
  return { question: newest, kind: QUESTIONS[newest.template as SmsTemplateKey]?.kind ?? "none" };
}
