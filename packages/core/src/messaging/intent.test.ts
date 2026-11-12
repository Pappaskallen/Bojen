import { describe, expect, it } from "vitest";
import {
  QUESTION_TEMPLATES,
  SMS_TEMPLATES,
  checkModelAnswer,
  closesAt,
  earliestSend,
  ignoresOptOut,
  needsPerson,
  planSms,
  routeInbound,
  ruleIntent,
  type QuestionKind,
  type ReplyIntent,
  type SentQuestion,
} from ".";

/** [reply, kind of question, expected intent or null when the model must read it, rating] */
const CASES: [string, QuestionKind, ReplyIntent | null, number?][] = [
  // The 24-hour check (F3): JA, NEJ, ÄNDRA in the ways people write them.
  ["JA", "availability_check", "yes"],
  ["ja", "availability_check", "yes"],
  ["Ja!", "availability_check", "yes"],
  [" ja. ", "availability_check", "yes"],
  ["j", "availability_check", "yes"],
  ["Japp", "availability_check", "yes"],
  ["jaaaa", "availability_check", "yes"],
  ["Ja tack", "availability_check", "yes"],
  ["👍", "availability_check", "yes"],
  ["👍🏽", "availability_check", "yes"],
  ["✅", "availability_check", "yes"],
  ["NEJ", "availability_check", "no"],
  ["nej.", "availability_check", "no"],
  ["Nä", "availability_check", "no"],
  ["ÄNDRA", "availability_check", "change"],
  ["ändra", "availability_check", "change"],
  ["andra", "availability_check", "change"],
  // STOPP is understood whatever was asked, also without a question.
  ["STOPP", "availability_check", "stop"],
  ["stop", "campaign", "stop"],
  ["Stopp!", "survey", "stop"],
  ["avsluta", "none", "stop"],
  // Campaigns (F10–F12): JA, ANNAN, NEJ.
  ["ja", "campaign", "yes"],
  ["ANNAN", "campaign", "another_time"],
  ["annan tid", "campaign", "another_time"],
  ["nej tack", "campaign", "no"],
  // "andra" means "other", not ÄNDRA, where ÄNDRA was not asked for.
  ["andra", "campaign", null],
  ["SÅLD", "sold_question", "sold"],
  ["sald", "sold_question", "sold"],
  ["Båten är såld", "sold_question", "sold"],
  // NY after the cancellation (F3, NEJ).
  ["NY", "rebook_offer", "call_me"],
  // The waiting list (F4).
  ["JA", "waitlist_offer", "yes"],
  ["nej", "waitlist_offer", "no"],
  // The satisfaction question (F9): 1–5.
  ["5", "survey", "rating", 5],
  ["4!", "survey", "rating", 4],
  ["1", "survey", "rating", 1],
  ["3/5", "survey", "rating", 3],
  ["6", "survey", null],
  ["0", "survey", null],
  ["ja", "survey", null],
  // An answer the question did not ask for, and free text: the model reads it.
  ["ANNAN", "availability_check", null],
  ["SÅLD", "campaign", null],
  ["5", "availability_check", null],
  ["ja", "none", null],
  ["Ja men nyckeln ligger hos grannen", "availability_check", null],
  ["Kan ni komma på torsdag istället?", "availability_check", null],
  ["12/10 Bullandö", "haulout_question", null],
  ["Jajamensan, vi ses!", "availability_check", null],
];

describe("the rules for replies", () => {
  it("has at least 40 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)("%j to %s → %s", (reply, kind, intent, rating) => {
    const result = ruleIntent(reply, kind);
    if (intent === null) {
      expect(result).toBeNull();
      return;
    }
    expect(result).toMatchObject({ intent, confidence: 1, source: "rule" });
    if (rating !== undefined) expect(result?.rating).toBe(rating);
  });

  it("an empty reply is unclear", () => {
    expect(ruleIntent("   ", "availability_check")).toMatchObject({
      intent: "unclear",
      confidence: 0,
    });
  });
});

describe("the model's answer", () => {
  it.each([
    [{ intent: "yes", confidence: 0.95 }, "availability_check", "yes", 0.95],
    [{ intent: "change", confidence: 0.7 }, "availability_check", "change", 0.7],
    [{ intent: "rating", confidence: 0.92, rating: 4 }, "survey", "rating", 0.92],
    [{ intent: "info", confidence: 0.93 }, "haulout_question", "info", 0.93],
    // Not asked for, out of range or broken: unclear, no confidence.
    [{ intent: "sold", confidence: 0.99 }, "availability_check", "unclear", 0],
    [{ intent: "rating", confidence: 0.99, rating: 7 }, "survey", "unclear", 0],
    [{ intent: "rating", confidence: 0.99 }, "survey", "unclear", 0],
    [{ intent: "yes", confidence: 1.4 }, "availability_check", "unclear", 0],
    [{ intent: "yes", confidence: Number.NaN }, "availability_check", "unclear", 0],
    [{ intent: "delete_everything", confidence: 1 }, "campaign", "unclear", 0],
  ] as const)("%j to %s → %s", (answer, kind, intent, confidence) => {
    expect(checkModelAnswer(answer, kind)).toMatchObject({ intent, confidence });
  });

  it("a person reads anything unclear or under 90 % sure", () => {
    expect(needsPerson({ intent: "yes", confidence: 0.95, source: "model" })).toBe(false);
    expect(needsPerson({ intent: "yes", confidence: 0.89, source: "model" })).toBe(true);
    expect(needsPerson({ intent: "unclear", confidence: 1, source: "model" })).toBe(true);
    expect(needsPerson({ intent: "no", confidence: 1, source: "rule" })).toBe(false);
  });
});

describe("which question a reply answers", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  const ahead = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
  const q = (id: string, template: string, sentAt: Date, rest: Partial<SentQuestion> = {}) => ({
    id,
    template,
    sentAt,
    visitStart: null,
    answered: false,
    ...rest,
  });

  it("the newest open question wins", () => {
    const route = routeInbound(
      [
        q("check-a", "f3_check_water", ago(30), { visitStart: ahead(2) }),
        q("survey-b", "f9_survey", ago(2)),
      ],
      now,
    );
    expect(route).toMatchObject({ question: { id: "survey-b" }, kind: "survey" });
  });

  it("a reply to an older question does not land on a visit that has passed", () => {
    // Last week's check for visit A; the visit is over, so the question is closed.
    const route = routeInbound(
      [q("check-a", "f3_check_water", ago(24 * 8), { visitStart: ago(24 * 7) })],
      now,
    );
    expect(route).toEqual({ question: null, kind: "none" });
  });

  it("an answered question is closed, so the reply goes to the one still open", () => {
    const route = routeInbound(
      [
        q("check-b", "f3_check_land", ago(1), { visitStart: ahead(23), answered: true }),
        q("check-a", "f3_check_water", ago(5), { visitStart: ahead(19) }),
      ],
      now,
    );
    expect(route.question?.id).toBe("check-a");
  });

  it("a waiting-list offer is open for one hour", () => {
    expect(routeInbound([q("offer", "f4_offer", ago(0.5))], now).kind).toBe("waitlist_offer");
    expect(routeInbound([q("offer", "f4_offer", ago(1.1))], now).kind).toBe("none");
  });

  it("a campaign is open for 14 days, the survey for 7", () => {
    expect(routeInbound([q("c", "f11_spring_a", ago(24 * 13))], now).kind).toBe("campaign");
    expect(routeInbound([q("c", "f11_spring_a", ago(24 * 15))], now).kind).toBe("none");
    expect(routeInbound([q("s", "f9_survey", ago(24 * 8))], now).kind).toBe("none");
  });

  it("messages that ask nothing are not questions", () => {
    expect(routeInbound([q("eta", "f5_eta", ago(1))], now).kind).toBe("none");
    expect(closesAt({ template: "f5_eta", sentAt: ago(1), visitStart: null })).toEqual(ago(1));
  });

  it("every question template exists", () => {
    for (const template of QUESTION_TEMPLATES) expect(SMS_TEMPLATES).toHaveProperty(template);
  });
});

describe("the STOPP receipt", () => {
  it("goes out at once, at night and to the number that just opted out", () => {
    const night = new Date("2026-11-12T23:30:00+01:00");
    expect(ignoresOptOut("receipt")).toBe(true);
    expect(earliestSend(night, "receipt")).toEqual(night);
    expect(
      planSms({ category: "receipt", to: "+46701234567", optedOut: true, now: night }),
    ).toEqual({ action: "send", at: night });
  });
});
