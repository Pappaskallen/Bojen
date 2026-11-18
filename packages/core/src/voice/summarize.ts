/**
 * After the call (byggplan step 6.3): the transcript as text, and the summary in five points
 * that the firm reads on the call. Pure; the summary itself comes from Claude Sonnet 5.5
 * through the `CallSummarizer` port.
 */
import type { ConversationMessage } from "./conversation";
import { scrubSensitive } from "./scrub";

export const SUMMARY_POINTS = 5;
export const CALL_OUTCOMES = ["booked", "message", "transferred", "spam"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** What the caller wanted (KPI 22): to book, an emergency, a question, or something else. */
export const CALL_INTENTS = ["book", "emergency", "question", "other"] as const;
export type CallIntent = (typeof CALL_INTENTS)[number];

export interface CallSummary {
  points: string[];
  /** What the call came to, when the summary can tell; the agent's own outcome wins. */
  outcome: CallOutcome | null;
  /** What the caller wanted, when the summary can tell; the agent's own wins. */
  intent: CallIntent | null;
}

/**
 * The conversation as lines, "Kund: …" and "Receptionist: …", without the tools' data. The
 * opening placeholder is left out, and card and personal numbers are taken out.
 */
export function transcriptText(messages: readonly ConversationMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const said =
      typeof m.content === "string"
        ? m.content
        : m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ");
    // The system's own notes to the model (K7) are not what anyone said.
    const spoken = said.replace(/\(Systemnotis:[^)]*\)/g, "").trim();
    if (!spoken || spoken === "(Samtalet kopplas upp.)") continue;
    lines.push(`${m.role === "user" ? "Kund" : "Receptionist"}: ${spoken}`);
  }
  return scrubSensitive(lines.join("\n"));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The model's summary made safe to keep: at most five short points, numbers scrubbed. */
export function normaliseSummary(raw: unknown): CallSummary {
  const r = isRecord(raw) ? raw : {};
  const points = (Array.isArray(r.points) ? r.points : [])
    .flatMap((p) =>
      typeof p === "string" && p.trim()
        ? [scrubSensitive(p.replace(/\s+/g, " ").trim().slice(0, 200))]
        : [],
    )
    .slice(0, SUMMARY_POINTS);
  const outcome = CALL_OUTCOMES.find((o) => o === r.outcome) ?? null;
  const intent = CALL_INTENTS.find((o) => o === r.intent) ?? null;
  return { points, outcome, intent };
}

/** The summary as the text kept on the call, a point per line. */
export const summaryText = (s: CallSummary) => s.points.map((p) => `- ${p}`).join("\n");
