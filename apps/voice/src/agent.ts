/**
 * The receptionist in a call (byggplan step 6.2): it keeps the conversation, asks the model,
 * runs the tools the model calls through the tool API, and hands back what to say. The same
 * agent runs against fakes in tests and the simulator, and against Claude, Azure and LiveKit
 * in a real call.
 */
import { callNudge, type CallDialer } from "@bojen/core";
import type {
  ConversationBlock,
  ConversationMessage,
  ConversationModel,
  ConversationTool,
} from "@bojen/core";
import type { ToolsClient } from "./tools-client";
import { TRANSFER_TOOL, transferCall, transferOrder } from "./transfer";

/** Tool rounds in one turn before the agent gives up and offers a message (spec 8.4 K7). */
export const MAX_TOOL_ROUNDS = 6;

/** Said when the model cannot go on: refused, cut off, or too many tool rounds. */
export const FALLBACK_LINE =
  "Förlåt, jag kommer inte vidare just nu. Vill du att jag tar ett meddelande så ringer vi upp dig?";

export interface CallAgent {
  /** What the caller said; the answer to say. Empty when the turn was cut off by barge-in. */
  reply(
    text: string,
    options?: { signal?: AbortSignal; onText?: (delta: string) => void },
  ): Promise<string>;
  /** The model ended the call with avsluta_samtal. */
  readonly ended: boolean;
  /** The conversation so far, for the log and the tests. */
  readonly messages: readonly ConversationMessage[];
}

export function createCallAgent(input: {
  model: ConversationModel;
  tools: ToolsClient;
  token: string;
  definitions: readonly ConversationTool[];
  system: { stable: string; context: string };
  /** The first line the system already said, kept so the model knows the call has begun. */
  firstLine: string;
  /** Rings the mechanic for koppla_till_mekaniker (step 6.4); null: no one answers. */
  dialer?: CallDialer | null;
  /** Milliseconds, for how long the call has gone on (K7). */
  now?: () => number;
}): CallAgent {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  // K7: two fallbacks in a row, or eight minutes, and the model is reminded to offer a message.
  let failedInRow = 0;
  let nudged = false;
  const messages: ConversationMessage[] = [];
  let ended = false;
  // The model's turns must start with a user turn; the first line is the assistant's own.
  let pendingOpening = true;

  async function reply(
    text: string,
    options: { signal?: AbortSignal; onText?: (delta: string) => void } = {},
  ): Promise<string> {
    // Only the system writes notes to the model: a caller cannot say one.
    const heard = text.replace(/\(\s*systemnotis[^)]*\)?/gi, "").trim();
    if (!heard || ended) return "";
    const nudge = callNudge({
      minutes: (now() - startedAt) / 60_000,
      failedInRow,
      alreadyNudged: nudged,
    });
    if (nudge) nudged = true;
    const said = nudge ? `${heard}

${nudge}` : heard;
    // What the turn adds stays apart until it is whole: a turn cut short leaves no half.
    const turn: ConversationMessage[] = pendingOpening
      ? [
          { role: "user", content: "(Samtalet kopplas upp.)" },
          { role: "assistant", content: input.firstLine },
          { role: "user", content: said },
        ]
      : [{ role: "user", content: said }];
    const spoken: string[] = [];
    let toolsRan = false;
    // Cut off by the caller: nothing is said, but what the tools did stays in the history.
    const interrupted = () => {
      if (toolsRan) {
        turn.push({ role: "assistant", content: "(Kunden avbröt.)" });
        commit(turn);
      }
      return "";
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (options.signal?.aborted) return interrupted();
      let result;
      try {
        result = await input.model.turn({
          system: input.system,
          tools: input.definitions,
          messages: [...messages, ...turn],
          ...(options.onText ? { onText: options.onText } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted) return interrupted();
        throw error;
      }
      if (options.signal?.aborted) return interrupted();
      const text = result.content
        .filter((b): b is Extract<ConversationBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text.trim()) spoken.push(text.trim());
      const uses = result.content.filter(
        (b): b is Extract<ConversationBlock, { type: "tool_use" }> => b.type === "tool_use",
      );

      if (
        result.stopReason === "refusal" ||
        (result.stopReason === "max_tokens" && uses.length > 0)
      ) {
        // Never run tools from a turn that was cut off or refused.
        turn.push({ role: "assistant", content: FALLBACK_LINE });
        commit(turn);
        failedInRow++;
        return FALLBACK_LINE;
      }
      turn.push({ role: "assistant", content: result.content });
      if (uses.length === 0) {
        commit(turn);
        failedInRow = 0;
        return spoken.join(" ");
      }

      const results: ConversationBlock[] = [];
      for (const use of uses) {
        let answer = await input.tools.run(input.token, use.name, use.input);
        if (use.name === TRANSFER_TOOL && hasTransfer(answer)) {
          // The mechanics' numbers never reach the model, whatever the answer looked like.
          const order = transferOrder(answer);
          answer = order
            ? await transferCall({
                order,
                dialer: input.dialer ?? null,
                report: (result) => input.tools.run(input.token, "kopplingsutfall", result),
              })
            : { status: "ej_svar" };
        }
        if (use.name === "avsluta_samtal") ended = true;
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(answer),
          ...(isRefusal(answer) ? { is_error: true } : {}),
        });
      }
      turn.push({ role: "user", content: results });
      toolsRan = true;
      if (ended) {
        commit(turn);
        return spoken.join(" ");
      }
    }
    turn.push({ role: "assistant", content: FALLBACK_LINE });
    commit(turn);
    failedInRow++;
    return FALLBACK_LINE;
  }

  function commit(turn: ConversationMessage[]) {
    messages.push(...turn);
    pendingOpening = false;
  }

  return {
    reply,
    get ended() {
      return ended;
    },
    get messages() {
      return messages;
    },
  };
}

const hasTransfer = (answer: unknown) =>
  typeof answer === "object" && answer !== null && "koppling" in answer;

const isRefusal = (answer: unknown) =>
  typeof answer === "object" && answer !== null && "fel" in answer;
