/**
 * One simulated call (byggplan step 6.5): the receptionist (the same agent and prompt as a
 * real call) against a simulated caller, by text, with the tools answering from the
 * scenario's world. The caller is a model playing the persona; in the tests it is a script.
 */
import { createFakeDialer } from "@bojen/adapters";
import type { ConversationModel } from "@bojen/core";
import { createCallAgent } from "../src/agent";
import { contextPrompt, firstLine, stablePrompt } from "../src/prompt";
import { ALLOWED_AMOUNTS, MECHANIC_NUMBER } from "./firm";
import { gradeCall, type CallGrade } from "./grade";
import type { Scenario } from "./scenarios";
import { createEvalWorld, type ToolCall } from "./world";

/** The caller's side: the receptionist's last line in, the caller's next line out. */
export interface SimulatedCaller {
  /** null: the caller hangs up. */
  next(receptionist: string): Promise<string | null>;
}

/** Turns before a call is cut off; a real call that long would have been a message. */
export const MAX_TURNS = 14;

/** What the simulated caller writes to hang up. */
export const HANG_UP_MARK = "[LÄGGER PÅ]";

export interface CallRun {
  scenario: Scenario;
  transcript: { who: "receptionist" | "kund"; text: string }[];
  calls: ToolCall[];
  grade: CallGrade;
  /** Milliseconds per receptionist turn, for the report. */
  turnMs: number[];
}

export async function runScenario(input: {
  scenario: Scenario;
  model: ConversationModel;
  caller: SimulatedCaller;
  maxTurns?: number;
}): Promise<CallRun> {
  const { scenario } = input;
  const world = createEvalWorld(scenario);
  const opening = firstLine(world.started.firma);
  const agent = createCallAgent({
    model: input.model,
    tools: world.tools,
    token: world.started.token,
    definitions: world.started.verktyg,
    system: {
      stable: stablePrompt(world.started.firma),
      context: contextPrompt(world.started.kontext),
    },
    firstLine: opening,
    dialer: createFakeDialer(scenario.world.answers ? [MECHANIC_NUMBER] : []),
  });

  const transcript: CallRun["transcript"] = [{ who: "receptionist", text: opening }];
  const turnMs: number[] = [];
  let line: string | null = scenario.opening;
  for (let turn = 0; turn < (input.maxTurns ?? MAX_TURNS) && line !== null; turn++) {
    transcript.push({ who: "kund", text: line });
    const t0 = performance.now();
    const answer = await agent.reply(line);
    turnMs.push(Math.round(performance.now() - t0));
    if (answer) transcript.push({ who: "receptionist", text: answer });
    if (agent.ended) break;
    const next = await input.caller.next(answer);
    line = next === null || next.includes(HANG_UP_MARK) ? null : next;
  }

  const said = transcript
    .slice(1)
    .filter((t) => t.who === "receptionist")
    .map((t) => t.text);
  const heard = transcript.filter((t) => t.who === "kund").map((t) => t.text);
  return {
    scenario,
    transcript,
    calls: world.calls,
    turnMs,
    grade: gradeCall({
      scenario,
      calls: world.calls,
      said,
      heard,
      allowedAmounts: ALLOWED_AMOUNTS,
    }),
  };
}

/** A caller that says its lines in order and then hangs up: for the tests. */
export function scriptedCaller(lines: readonly string[]): SimulatedCaller {
  let next = 0;
  return { next: () => Promise.resolve(lines[next++] ?? null) };
}

/**
 * A caller played by a model from the scenario's persona. The receptionist's lines are the
 * model's user turns, and its own lines the assistant turns.
 */
export function modelCaller(model: ConversationModel, scenario: Scenario): SimulatedCaller {
  const system = {
    stable: `Du spelar en person som ringer till en båtmekaniker och pratar med firmans digitala receptionist i telefon. Håll dig till rollen och hitta inte på mer än rollen behöver. Svara med det personen säger, en eller två korta meningar, utan citattecken, regianvisningar eller förklaringar. När samtalet är slut för personens del, skriv bara ${HANG_UP_MARK}.`,
    context: `# Din roll\n${scenario.persona}`,
  };
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: "(Receptionisten svarar i telefon.)" },
    { role: "assistant", content: scenario.opening },
  ];
  return {
    async next(receptionist) {
      messages.push({ role: "user", content: receptionist || "(tystnad)" });
      const turn = await model.turn({ system, tools: [], messages });
      const said = turn.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join(" ")
        .trim();
      messages.push({ role: "assistant", content: said || HANG_UP_MARK });
      return said && !said.includes(HANG_UP_MARK) ? said : null;
    },
  };
}
