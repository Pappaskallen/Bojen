/**
 * What a reply by sms means (byggplan step 3.2). First fixed rules for the short answers the
 * templates ask for; whatever they do not cover goes to a language model (`ReplyClassifier`),
 * whose answer is checked here before it is trusted.
 */
import type { QuestionKind } from "./routeInbound";

export type ReplyIntent =
  | "yes"
  | "no"
  | "change"
  | "stop"
  /** ANNAN: another time, please. */
  | "another_time"
  /** A score 1–5 for the satisfaction question. */
  | "rating"
  /** SÅLD: the boat is sold. */
  | "sold"
  /** NY: call me to book a new time. */
  | "call_me"
  /** Information the question asked for, for example a haul-out date. */
  | "info"
  | "unclear";

export interface Interpretation {
  intent: ReplyIntent;
  /** 0–1. The rules are sure (1); the model says how sure it is. */
  confidence: number;
  rating?: 1 | 2 | 3 | 4 | 5;
  source: "rule" | "model" | "none";
}

/** Below this, a person reads the reply instead (spec F3 step 5). */
export const CONFIDENT = 0.9;

/** The answers each kind of question asks for. STOPP is always understood. */
export const ALLOWED_INTENTS: Record<QuestionKind, readonly ReplyIntent[]> = {
  availability_check: ["yes", "no", "change", "stop", "unclear"],
  rebook_offer: ["call_me", "change", "stop", "unclear"],
  waitlist_offer: ["yes", "no", "stop", "unclear"],
  survey: ["rating", "stop", "unclear"],
  campaign: ["yes", "another_time", "no", "stop", "unclear"],
  sold_question: ["sold", "no", "stop", "unclear"],
  haulout_question: ["info", "stop", "unclear"],
  time_offer: ["yes", "another_time", "no", "stop", "unclear"],
  none: ["stop", "unclear"],
};

/** Lower case, trimmed, without trailing punctuation and repeated letters ("jaaa" → "ja"). */
export function normalizeReply(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/\p{Emoji_Modifier}/gu, "") // 👍🏽 → 👍
    .replace(/️/g, "")
    .replace(/[\s.!?,;:)]+$/u, "")
    .replace(/^[\s(]+/u, "")
    .replace(/\s+/g, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1$1")
    .trim();
}

const RULES: [ReplyIntent, readonly string[]][] = [
  ["stop", ["stopp", "stop", "avsluta", "avregistrera"]],
  [
    "yes",
    ["ja", "j", "jaa", "japp", "jepp", "jajamen", "ja tack", "jadå", "absolut", "👍", "✅", "👌"],
  ],
  ["no", ["nej", "n", "nä", "nej tack", "nää"]],
  ["change", ["ändra", "andra"]],
  ["another_time", ["annan", "annan tid", "en annan tid", "annan dag"]],
  ["sold", ["såld", "sald", "sålt", "salt", "den är såld", "båten är såld"]],
  ["call_me", ["ny", "ny tid"]],
];

/**
 * The rules' reading of a reply to a question of `kind`, or null when the rules cannot
 * tell and the model should try. An answer the question did not ask for is not trusted:
 * "ja" to the satisfaction question goes to the model.
 */
export function ruleIntent(text: string, kind: QuestionKind): Interpretation | null {
  const reply = normalizeReply(text);
  if (reply === "") return { intent: "unclear", confidence: 0, source: "rule" };
  const allowed = ALLOWED_INTENTS[kind];
  if (kind === "survey") {
    const score = /^([1-5])(?: ?\/ ?5)?$/.exec(reply)?.[1];
    if (score) {
      return {
        intent: "rating",
        rating: Number(score) as 1 | 2 | 3 | 4 | 5,
        confidence: 1,
        source: "rule",
      };
    }
  }
  for (const [intent, words] of RULES) {
    if (!words.includes(reply)) continue;
    // "andra" without the dots is only "ändra" where ÄNDRA was asked for.
    if (reply === "andra" && kind !== "availability_check" && kind !== "rebook_offer") return null;
    return allowed.includes(intent) ? { intent, confidence: 1, source: "rule" } : null;
  }
  return null;
}

/**
 * Makes a model's answer safe to use: an intent the question did not ask for, a rating
 * outside 1–5 or a confidence outside 0–1 becomes "unclear" with no confidence.
 */
export function checkModelAnswer(
  answer: { intent: string; confidence: number; rating?: number | null },
  kind: QuestionKind,
): Interpretation {
  const unclear: Interpretation = { intent: "unclear", confidence: 0, source: "model" };
  const allowed: readonly string[] = ALLOWED_INTENTS[kind];
  if (!allowed.includes(answer.intent)) return unclear;
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
    return unclear;
  const intent = answer.intent as ReplyIntent;
  if (intent === "rating") {
    const r = answer.rating;
    if (typeof r !== "number" || !Number.isInteger(r) || r < 1 || r > 5) return unclear;
    return {
      intent,
      rating: r as 1 | 2 | 3 | 4 | 5,
      confidence: answer.confidence,
      source: "model",
    };
  }
  return { intent, confidence: answer.confidence, source: "model" };
}

/** A person must read the reply: the meaning is unclear or not certain enough. */
export function needsPerson(interpretation: Interpretation): boolean {
  return interpretation.intent === "unclear" || interpretation.confidence < CONFIDENT;
}
