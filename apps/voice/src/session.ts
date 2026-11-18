/**
 * One call from first line to hang-up (byggplan step 6.2): the caller's audio goes through
 * speech to text, each final sentence to the agent, and the agent's answer back through
 * text to speech, sentence by sentence as the model writes it. When the caller starts
 * talking the agent stops at once (barge-in). The time from the caller's last word to the
 * first sound of the answer is measured for every turn (spec 8.5: p90 under 1.2 s).
 */
import {
  p90,
  splitSentences,
  type CallAudio,
  type SpeechToText,
  type TextToSpeech,
} from "@bojen/core";
import type { CallAgent } from "./agent";

export interface CallLog {
  /** Milliseconds from the final transcript to the first audio of the answer, per turn. */
  latencies: number[];
  turns: { caller: string; agent: string; interrupted: boolean }[];
}

/** Interim words shorter than this are noise, not the caller talking over the agent. */
const BARGE_IN_CHARS = 3;

export async function runCall(input: {
  audio: CallAudio;
  stt: SpeechToText;
  tts: TextToSpeech;
  agent: CallAgent;
  firstLine: string;
  now?: () => number;
}): Promise<CallLog & { p90: number | null }> {
  const now = input.now ?? (() => performance.now());
  const log: CallLog = { latencies: [], turns: [] };
  type Turn = { controller: AbortController; done: Promise<void> };
  let current: Turn | null = null;
  let hungUp = false;
  const hangUp = async () => {
    if (hungUp) return;
    hungUp = true;
    await input.audio.hangUp();
  };

  /** Plays one sentence; notes when its first sound came, for the turn's latency. */
  async function say(text: string, signal: AbortSignal, onFirstSound?: () => void) {
    const tts = input.tts;
    async function* sound() {
      let first = true;
      for await (const chunk of tts.synthesize(text, signal)) {
        if (first) {
          first = false;
          onFirstSound?.();
        }
        yield chunk;
      }
    }
    await input.audio.play(sound(), signal);
  }

  function startTurn(caller: string): Turn {
    const controller = new AbortController();
    const signal = controller.signal;
    const heard = now();
    let measured = false;
    const firstSound = () => {
      if (measured) return;
      measured = true;
      log.latencies.push(Math.round(now() - heard));
    };
    // Sentences are spoken one after another while the model is still writing.
    let buffer = "";
    let speaking = Promise.resolve();
    let streamed = false;
    const speak = (sentence: string) => {
      speaking = speaking.then(() =>
        signal.aborted ? undefined : say(sentence, signal, firstSound),
      );
    };
    const done = (async () => {
      let answer = "";
      try {
        answer = await input.agent.reply(caller, {
          signal,
          onText: (delta) => {
            streamed = true;
            buffer += delta;
            const { sentences, rest } = splitSentences(buffer);
            buffer = rest;
            sentences.forEach(speak);
          },
        });
        if (!signal.aborted) {
          if (streamed && buffer.trim()) speak(buffer.trim());
          // A turn that was not streamed (a fallback line) is spoken whole.
          if (!streamed && answer) speak(answer);
          buffer = "";
        }
        await speaking;
      } finally {
        log.turns.push({ caller, agent: answer, interrupted: signal.aborted });
      }
    })();
    return { controller, done };
  }

  await say(input.firstLine, new AbortController().signal);

  for await (const t of input.stt.transcripts(input.audio.incoming)) {
    const words = t.text.trim();
    if (!t.final) {
      // The caller talks over the answer: stop speaking and thinking at once.
      if (current && words.length >= BARGE_IN_CHARS) current.controller.abort();
      continue;
    }
    if (!words) continue;
    if (current) {
      current.controller.abort();
      await current.done.catch(() => undefined);
    }
    const turn = startTurn(words);
    current = turn;
    // The next words are read while this turn is spoken; the call ends with the agent.
    void turn.done.then(async () => {
      if (input.agent.ended) await hangUp();
    });
  }
  const last: Turn | null = current;
  if (last) await last.done.catch(() => undefined);
  if (input.agent.ended) await hangUp();
  return { ...log, p90: p90(log.latencies) };
}
