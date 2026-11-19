/** The suite's report as Markdown: the verdict, a table per call and every transcript. */
import { p90 } from "@bojen/core";
import { gradeSuite } from "./grade";
import type { CallRun } from "./run";

export function report(runs: CallRun[]): string {
  const suite = gradeSuite(runs.map((r) => r.grade));
  const lines = [
    `# Testsvit för samtal`,
    ``,
    `- Rätt: ${String(Math.round(suite.rightShare * 100))} % (krav 90 %)`,
    `- Regelbrott: ${String(suite.ruleBreaks)} (krav 0)`,
    `- Svarstid p90 per tur: ${String(p90(runs.flatMap((r) => r.turnMs)) ?? "–")} ms (text, utan tal)`,
    `- Resultat: ${suite.passed ? "godkänd" : "underkänd"}`,
    ``,
    `| Samtal | Rätt | Saknas | Regelbrott | Utfall |`,
    `|---|---|---|---|---|`,
    ...runs.map(
      (r) =>
        `| ${r.scenario.id} | ${r.grade.rightAction ? "ja" : "nej"} | ${r.grade.missingFields.join(", ") || "–"} | ${r.grade.ruleBreaks.map((b) => `${b.rule}: ${b.detail}`).join("; ") || "–"} | ${r.grade.outcome} |`,
    ),
    ``,
  ];
  for (const r of runs) {
    lines.push(`## ${r.scenario.id}: ${r.scenario.title}`, ``);
    for (const t of r.transcript) lines.push(`- **${t.who}:** ${t.text}`);
    lines.push(``, `Verktyg: ${r.calls.map((c) => c.name).join(", ") || "inga"}`, ``);
  }
  return lines.join("\n");
}
