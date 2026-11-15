import Anthropic from "@anthropic-ai/sdk";
import type { ConversationBlock, ConversationModel, ModelTurn } from "@bojen/core";

/** CLAUDE.md: Haiku 5.5 in real time, effort `low`. */
export const VOICE_MODEL = "claude-haiku-5-5";

export interface ClaudeConversationOptions {
  /** Default: the SDK reads ANTHROPIC_API_KEY from the environment. */
  client?: Anthropic;
  /** Short spoken answers; a tool call needs a little more. */
  maxTokens?: number;
}

const STOP: Record<string, ModelTurn["stopReason"]> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  refusal: "refusal",
  max_tokens: "max_tokens",
};

/**
 * The model in the call (byggplan step 6.2): Claude Haiku 5.5, effort `low` and no thinking,
 * for the first words in a few hundred milliseconds. Streamed, so speech starts with the
 * first sentence. The firm's part of the prompt (with the tools before it) is cached; the
 * caller's context comes after the breakpoint, last. Haiku 5.5 has no server-side fallback;
 * a refusal is passed on as such, and the agent offers a message.
 */
export function createClaudeConversation(
  options: ClaudeConversationOptions = {},
): ConversationModel {
  const client = options.client ?? new Anthropic();
  return {
    async turn({ system, tools, messages, onText, signal }) {
      for (let attempt = 0; ; attempt++) {
        const stream = client.messages.stream(
          {
            model: VOICE_MODEL,
            max_tokens: options.maxTokens ?? 1024,
            thinking: { type: "disabled" },
            output_config: { effort: "low" },
            system: [
              { type: "text", text: system.stable, cache_control: { type: "ephemeral" } },
              { type: "text", text: system.context },
            ],
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.input_schema as Anthropic.Tool.InputSchema,
              eager_input_streaming: true,
            })),
            messages: messages as Anthropic.MessageParam[],
          },
          signal ? { signal } : undefined,
        );
        if (onText) stream.on("text", onText);
        let message: Anthropic.Message;
        try {
          message = await stream.finalMessage();
        } catch (error) {
          // API errors and barge-in go to the agent. A tool input that could not be parsed
          // at all (eager input streaming) is asked for once more.
          if (error instanceof Anthropic.APIError || signal?.aborted || attempt >= 1) throw error;
          continue;
        }
        const content: ConversationBlock[] = message.content.flatMap((b): ConversationBlock[] =>
          b.type === "text"
            ? [{ type: "text", text: b.text }]
            : b.type === "tool_use"
              ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input }]
              : [],
        );
        return { stopReason: STOP[message.stop_reason ?? ""] ?? "other", content };
      }
    },
  };
}
