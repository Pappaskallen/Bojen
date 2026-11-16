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

export interface CallSummary {
  points: string[];
  /** What the call came to, when the summary can tell; the agent's own outcome wins. */
  outcome: CallOutcome | null;
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
    if (!said.trim() || said === "(Samtalet kopplas upp.)") continue;
    lines.push(`${m.role === "user" ? "Kund" : "Receptionist"}: ${said.trim()}`);
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
  return { points, outcome };
}

/** The summary as the text kept on the call, a point per line. */
export const summaryText = (s: CallSummary) => s.points.map((p) => `- ${p}`).join("\n");
