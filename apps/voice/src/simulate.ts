/**
 * A call in the terminal, by text (byggplan step 6.2): the same agent, prompt and tool API
 * as a real call, with what you type in place of speech. Run the web app first.
 *
 *   VOICE_SERVICE_SECRET=… FIRM_NUMBER=+4676… CALLER=+4670… pnpm --filter @bojen/voice simulate
 *
 * With ANTHROPIC_API_KEY set, Claude Haiku 5.5 answers (that costs a little per turn);
 * without it a fake model that only repeats you, to try the tools and the plumbing.
 */
import { createInterface } from "node:readline/promises";
import { createClaudeConversation, createFakeConversation } from "@bojen/adapters";
import type { ConversationModel } from "@bojen/core";
import { createCallAgent } from "./agent";
import { contextPrompt, firstLine, stablePrompt } from "./prompt";
import { createToolsClient } from "./tools-client";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see the comment at the top of simulate.ts)`);
  return value;
}

async function main() {
  const tools = createToolsClient({
    baseUrl: process.env.VOICE_TOOLS_URL ?? "http://localhost:3000",
    serviceSecret: required("VOICE_SERVICE_SECRET"),
  });
  const started = await tools.startCall({
    to: required("FIRM_NUMBER"),
    from: process.env.CALLER ?? null,
    externalId: `simulate-${String(Date.now())}`,
  });
  if (!started) throw new Error("No firm answers FIRM_NUMBER (tenant.settings.sms.from)");

  const model: ConversationModel = process.env.ANTHROPIC_API_KEY
    ? createClaudeConversation()
    : createFakeConversation((input) => {
        const last = input.messages.at(-1);
        const said = typeof last?.content === "string" ? last.content : "";
        return {
          stopReason: "end_turn",
          content: [{ type: "text", text: `(Fejkmodellen hörde:) ${said}` }],
        };
      });
  if (process.env.ANTHROPIC_API_KEY)
    console.info("[simulate] Claude Haiku 5.5 answers: each turn costs a little.");

  const opening = firstLine(started.firma);
  const agent = createCallAgent({
    model,
    tools,
    token: started.token,
    definitions: started.verktyg,
    system: { stable: stablePrompt(started.firma), context: contextPrompt(started.kontext) },
    firstLine: opening,
  });
  console.info(`\nReceptionisten: ${opening}`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  while (!agent.ended) {
    const said = await terminal.question("\nDu: ").catch(() => null);
    if (said === null || said.trim() === "/slut") break;
    const t0 = performance.now();
    const answer = await agent.reply(said);
    console.info(`Receptionisten (${String(Math.round(performance.now() - t0))} ms): ${answer}`);
  }
  terminal.close();
}

main().catch((error: unknown) => {
  console.error("[simulate]", (error as Error).message);
  process.exitCode = 1;
});
