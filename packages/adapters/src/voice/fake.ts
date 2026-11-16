import type {
  CallAudio,
  CallDialer,
  ConversationModel,
  ModelTurn,
  SpeechToText,
  TextToSpeech,
  Transcript,
} from "@bojen/core";

type TurnInput = Parameters<ConversationModel["turn"]>[0];

export interface FakeConversation extends ConversationModel {
  /** What each turn was given, in order. */
  readonly calls: TurnInput[];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });

/**
 * A model that answers from a script: each turn is the next of `turns`, or what `answer`
 * makes of the input. Text is handed out word by word, with `delayMs` before each, so speech
 * and barge-in can be tested. Never calls anything outside the process.
 */
export function createFakeConversation(
  turns: ModelTurn[] | ((input: TurnInput) => ModelTurn),
  options: { delayMs?: number } = {},
): FakeConversation {
  const calls: TurnInput[] = [];
  let next = 0;
  return {
    calls,
    async turn(input) {
      calls.push({ ...input, messages: [...input.messages] });
      const turn = typeof turns === "function" ? turns(input) : turns[next++];
      if (!turn) throw new Error("The fake conversation has no more turns");
      for (const block of turn.content) {
        if (block.type !== "text") continue;
        for (const word of block.text.split(/(?<= )/)) {
          await sleep(options.delayMs ?? 0, input.signal);
          if (input.signal?.aborted) throw new Error("aborted");
          input.onText?.(word);
        }
      }
      await sleep(options.delayMs ?? 0, input.signal);
      if (input.signal?.aborted) throw new Error("aborted");
      return turn;
    },
  };
}

/** Speech to text that hears the given transcripts, with `delayMs` before each. */
export function createFakeSpeechToText(
  heard: Transcript[],
  options: { delayMs?: number } = {},
): SpeechToText {
  return {
    async *transcripts() {
      for (const t of heard) {
        await sleep(options.delayMs ?? 0);
        yield t;
      }
    },
  };
}

export interface FakeTextToSpeech extends TextToSpeech {
  /** Every text it was asked to say, in order. */
  readonly said: string[];
}

/** Text to speech that "speaks" the text as its bytes, after `delayMs`. */
export function createFakeTextToSpeech(options: { delayMs?: number } = {}): FakeTextToSpeech {
  const said: string[] = [];
  return {
    said,
    async *synthesize(text, signal) {
      said.push(text);
      await sleep(options.delayMs ?? 0, signal).catch(() => undefined);
      if (signal?.aborted) return;
      yield new TextEncoder().encode(text);
    },
  };
}

export interface FakeCallAudio extends CallAudio {
  /** What the caller heard, as text, in order; a sentence cut off by barge-in is not here. */
  readonly heard: string[];
  readonly hungUp: boolean;
}

/** A call with nothing coming in (the fake speech to text has the words) and a speaker. */
export function createFakeCallAudio(): FakeCallAudio {
  const heard: string[] = [];
  let hungUp = false;
  return {
    heard,
    get hungUp() {
      return hungUp;
    },
    incoming: (async function* () {})(),
    async play(audio, signal) {
      const parts: string[] = [];
      for await (const chunk of audio) {
        if (signal?.aborted) return;
        parts.push(new TextDecoder().decode(chunk));
      }
      if (!signal?.aborted && parts.length > 0) heard.push(parts.join(""));
    },
    hangUp() {
      hungUp = true;
      return Promise.resolve();
    },
  };
}

export interface FakeDialer extends CallDialer {
  /** Every number rung, with the whisper said to it. */
  readonly calls: { number: string; whisper: string; timeoutSeconds: number }[];
}

/** A phone that answers for the numbers in `answering`, and rings out for the rest. */
export function createFakeDialer(answering: readonly string[] = []): FakeDialer {
  const calls: FakeDialer["calls"] = [];
  return {
    calls,
    dial(input) {
      calls.push({ number: input.number, whisper: input.whisper, timeoutSeconds: input.timeoutSeconds });
      return Promise.resolve(answering.includes(input.number) ? "answered" : "no_answer");
    },
  };
}
