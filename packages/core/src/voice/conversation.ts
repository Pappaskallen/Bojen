/**
 * The receptionist's conversation (byggplan step 6.2): the ports the voice agent talks
 * through, so the agent is the same whether it runs against fakes or against LiveKit, Azure
 * Speech and Claude. Pure types and small helpers; the adapters live in packages/adapters.
 */

/** A block in the conversation, in the Messages API's shape. */
export type ConversationBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string | ConversationBlock[];
}

export interface ConversationTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelTurn {
  stopReason: "end_turn" | "tool_use" | "refusal" | "max_tokens" | "other";
  content: ConversationBlock[];
}

/**
 * The language model in the call: Claude Haiku 5.5 with effort `low` (CLAUDE.md), or a fake.
 * `system.stable` is the same for every call of a firm and is cached; `system.context` is the
 * caller's and comes last (spec 8.2).
 */
export interface ConversationModel {
  turn(input: {
    system: { stable: string; context: string };
    tools: readonly ConversationTool[];
    messages: readonly ConversationMessage[];
    /** Each piece of text as it comes, so speech can start before the turn is done. */
    onText?: (delta: string) => void;
    /** The caller started talking (barge-in): stop at once. */
    signal?: AbortSignal;
  }): Promise<ModelTurn>;
}

/** What speech to text heard: interim words while the caller talks, then the final text. */
export interface Transcript {
  text: string;
  final: boolean;
}

/** Swedish speech to text (Azure sv-SE with the word list, step 6.2), or a fake. */
export interface SpeechToText {
  transcripts(audio: AsyncIterable<Uint8Array>): AsyncIterable<Transcript>;
}

/** Swedish text to speech (Azure Neural sv-SE), or a fake. */
export interface TextToSpeech {
  synthesize(text: string, signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

/**
 * The call's audio, from the telephony side (LiveKit with 46elks over SIP): what the caller
 * says, a way to play speech to them, and hanging up.
 */
export interface CallAudio {
  incoming: AsyncIterable<Uint8Array>;
  play(audio: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void>;
  hangUp(): Promise<void>;
}

/** The 90th percentile of the times, in milliseconds (spec 8.5: p90 under 1.2 s). */
export function p90(times: readonly number[]): number | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)] ?? null;
}

/**
 * Sentences as they become complete in streamed text, so each can be spoken while the next
 * is written. Returns the complete sentences and what is left over.
 */
export function splitSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const match = /^(.*?[.!?])(\s+)/s.exec(rest);
    if (!match?.[1] || match[2] === undefined) break;
    sentences.push(match[1].trim());
    rest = rest.slice(match[1].length + match[2].length);
  }
  return { sentences, rest };
}
