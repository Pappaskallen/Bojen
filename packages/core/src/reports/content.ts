import { crm } from "../i18n/sv";
import type { Recommendation, ReportFacts } from "./draft";

/** The approved report as the texts of the e-mail to the customer (F7, `report.approved`). */
export interface ReportContent {
  workDone: string;
  hours: string;
  previousHours: string;
  parts: string;
  recommendations: string;
  nextService: string;
}

const t = crm.report;
const h = (value: number) => `${value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

/**
 * The approved report and what the visit recorded, as the e-mail's parts. An empty part stays
 * empty; the flow writes "–" for it.
 */
export function reportContent(
  report: { workDone: string[]; recommendations: Recommendation[]; nextService: string | null },
  facts: Pick<ReportFacts, "engines" | "parts">,
): ReportContent {
  const read = facts.engines.filter((e) => e.hours !== null);
  const before = facts.engines.filter((e) => e.previousHours !== null);
  return {
    workDone: bullets(report.workDone),
    hours: read.map((e) => t.hoursLine(e.label, h(e.hours ?? 0))).join(", "),
    previousHours: before.map((e) => t.hoursLine(e.label, h(e.previousHours ?? 0))).join(", "),
    parts: bullets(
      facts.parts
        .filter((p) => p.status === "installed")
        .map((p) => t.partLine(p.description, p.articleNumber, p.quantity.toLocaleString("sv-SE"))),
    ),
    recommendations: bullets(
      report.recommendations.map((r) =>
        t.recommendationLine(t.priority[r.priority] ?? r.priority, r.text),
      ),
    ),
    nextService: report.nextService ?? "",
  };
}
