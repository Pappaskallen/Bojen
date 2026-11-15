/**
 * The draft of the service report (byggplan step 5.5d, spec P6 and F7): what the mechanic
 * recorded on the visit goes to the model, which writes the work done, recommendations and
 * the next service. The mechanic reads, changes and approves it before the customer sees it.
 *
 * Only facts about the work are sent: never the customer's name, number, address or codes.
 */

export const RECOMMENDATION_PRIORITIES = ["now", "next_season", "monitor"] as const;
export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

export interface Recommendation {
  text: string;
  priority: RecommendationPriority;
}

/** What the visit recorded, the input to the draft. */
export interface ReportFacts {
  service: string | null;
  /** What the customer wrote when booking. */
  description: string | null;
  boat: string | null;
  engines: { label: string; hours: number | null; previousHours: number | null }[];
  parts: { articleNumber: string; description: string; quantity: number; status: string }[];
  /** What the mechanic typed on site. */
  notes: string | null;
  /** What the mechanic said in voice notes, transcribed. */
  voiceNotes: string[];
  photos: number;
}

/** What the model answers, after `normaliseDraft`. */
export interface ReportDraft {
  workDone: string[];
  recommendations: Recommendation[];
  nextService: string | null;
}

export const MAX_WORK_POINTS = 20;
export const MAX_RECOMMENDATIONS = 10;
export const MAX_POINT_LENGTH = 300;

const clean = (value: unknown, max = MAX_POINT_LENGTH): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const hours = (value: number | null) =>
  value === null ? "okänt" : `${value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;

/** The facts as the text the model reads. The mechanic's own words are marked as data. */
export function reportPrompt(facts: ReportFacts): string {
  const lines = [`Service: ${facts.service ?? "okänd"}`, `Båt: ${facts.boat ?? "okänd"}`];
  if (facts.description)
    lines.push(`Kundens beskrivning vid bokningen: ${clean(facts.description, 1000)}`);
  lines.push("", "Motorer (gångtimmar nu, förra avläsningen):");
  if (facts.engines.length === 0) lines.push("- inga registrerade");
  for (const e of facts.engines) {
    lines.push(`- ${e.label}: ${hours(e.hours)} (förra: ${hours(e.previousHours)})`);
  }
  lines.push("", "Delar på jobbet:");
  if (facts.parts.length === 0) lines.push("- inga");
  for (const p of facts.parts) {
    lines.push(
      `- ${p.description} (art.nr ${p.articleNumber}), antal ${String(p.quantity)}, ${p.status}`,
    );
  }
  lines.push("", `Bilder: ${String(facts.photos)}`);
  lines.push("", "<mechanic_notes>", clean(facts.notes, 4000) || "(inga)", "</mechanic_notes>");
  lines.push("", "<voice_notes>");
  if (facts.voiceNotes.length === 0) lines.push("(inga)");
  for (const v of facts.voiceNotes) lines.push(clean(v, 4000));
  lines.push("</voice_notes>");
  return lines.join("\n");
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The model's answer made safe to show: points trimmed and capped, empty ones dropped, and
 * priorities that are not one of the three read as `monitor`.
 */
export function normaliseDraft(raw: unknown): ReportDraft {
  const r = isRecord(raw) ? raw : {};
  const workDone = (Array.isArray(r.workDone) ? r.workDone : [])
    .map((w) => clean(w))
    .filter(Boolean)
    .slice(0, MAX_WORK_POINTS);
  const recommendations = (Array.isArray(r.recommendations) ? r.recommendations : [])
    .flatMap((x): Recommendation[] => {
      if (!isRecord(x)) return [];
      const text = clean(x.text);
      if (!text) return [];
      const priority = RECOMMENDATION_PRIORITIES.includes(x.priority as RecommendationPriority)
        ? (x.priority as RecommendationPriority)
        : "monitor";
      return [{ text, priority }];
    })
    .slice(0, MAX_RECOMMENDATIONS);
  const nextService = clean(r.nextService) || null;
  return { workDone, recommendations, nextService };
}

/** The work done as the mechanic edits it: one point per line. */
export const workDoneText = (points: readonly string[]) => points.join("\n");

/** Lines typed by the mechanic back into points. */
export function workDonePoints(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => clean(line.replace(/^\s*[-•*]\s*/, "")))
    .filter(Boolean)
    .slice(0, MAX_WORK_POINTS);
}
