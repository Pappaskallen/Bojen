/** The command for the test with real type plates; see nameplates.ts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClaudeNameplateReader } from "@bojen/adapters";
import { scorePlates, type Facit } from "./nameplates";

async function main() {
  const folder = process.argv[2];
  if (!folder) throw new Error("Give the folder: pnpm --filter @bojen/worker nameplates <folder>");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const facit = JSON.parse(readFileSync(join(folder, "facit.json"), "utf8")) as Facit[];
  const { results, right, passed } = await scorePlates(
    createClaudeNameplateReader(),
    facit,
    (file) => readFileSync(join(folder, file)),
  );
  for (const r of results) {
    console.info(`${r.right ? "rätt" : "fel "}  ${r.file}: väntat ${r.expected}, läst ${r.read}`);
  }
  console.info(
    `\n${String(right)} av ${String(results.length)} rätt: ${passed ? "godkänt" : "inte godkänt"}`,
  );
  process.exitCode = passed ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("[nameplates]", (error as Error).message);
  process.exitCode = 1;
});
