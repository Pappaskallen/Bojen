/**
 * The test suite for calls against Claude (byggplan step 6.5):
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @bojen/voice evals [--only id,id] [--report dir]
 *
 * Both the receptionist and the simulated caller are Claude Haiku 5.5, so a run of all 30
 * calls costs real money: about 30 × 10 turns of each, with the cached prompt. It writes a report
 * per run to `evals/results/` (git-ignored: it holds the simulated transcripts) and exits
 * with 1 unless at least 90 % are right and there are 0 rule breaks.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeConversation } from "@bojen/adapters";
import { gradeSuite } from "./grade";
import { report } from "./report";
import { modelCaller, runScenario, type CallRun } from "./run";
import { SCENARIOS } from "./scenarios";

function option(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY must be set: the suite runs against Claude and costs money");
  }
  const only = option("only")?.split(",");
  const scenarios = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  console.info(
    `[evals] ${String(scenarios.length)} samtal mot Claude Haiku 5.5. Det kostar pengar.`,
  );

  const runs: CallRun[] = [];
  for (const scenario of scenarios) {
    const run = await runScenario({
      scenario,
      model: createClaudeConversation(),
      caller: modelCaller(createClaudeConversation({ maxTokens: 300 }), scenario),
    });
    const g = run.grade;
    console.info(
      `[evals] ${scenario.id}: ${g.rightAction && g.missingFields.length === 0 ? "rätt" : "fel"}${g.ruleBreaks.length ? `, ${String(g.ruleBreaks.length)} regelbrott` : ""} (${g.outcome})`,
    );
    runs.push(run);
  }

  const suite = gradeSuite(runs.map((r) => r.grade));
  const dir = option("report") ?? fileURLToPath(new URL("./results/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `samtal-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, report(runs));
  console.info(
    `[evals] Rätt ${String(Math.round(suite.rightShare * 100))} %, ${String(suite.ruleBreaks)} regelbrott: ${suite.passed ? "godkänd" : "underkänd"}. Rapport: ${file}`,
  );
  if (!suite.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[evals]", (error as Error).message);
  process.exitCode = 1;
});
