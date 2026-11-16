/**
 * One phone call, from the ring to the transcript (byggplan steps 6.2 and 6.3): the call is
 * started with the tool API, the agent gets the firm's prompt and the caller's context, the
 * call runs, and afterwards the transcript is handed in for the summary. The same for a real
 * call (LiveKit, Azure, Claude) and for the fakes.
 */
import {
  transcriptText,
  type CallAudio,
  type ConversationModel,
  type SpeechToText,
  type TextToSpeech,
} from "@bojen/core";
import { createCallAgent } from "./agent";
import { contextPrompt, firstLine, stablePrompt } from "./prompt";
import { runCall } from "./session";
import type { ToolsClient } from "./tools-client";

export async function handleCall(input: {
  tools: ToolsClient;
  model: ConversationModel;
  stt: SpeechToText;
  tts: TextToSpeech;
  audio: CallAudio;
  /** The firm's number that was called, and the caller's (null when hidden). */
  to: string;
  from: string | null;
  externalId?: string;
}) {
  const started = await input.tools.startCall({
    to: input.to,
    from: input.from,
    ...(input.externalId ? { externalId: input.externalId } : {}),
  });
  if (!started) {
    // Not one of the firms' numbers: nothing to answer with.
    await input.audio.hangUp();
    return null;
  }
  const opening = firstLine(started.firma);
  const agent = createCallAgent({
    model: input.model,
    tools: input.tools,
    token: started.token,
    definitions: started.verktyg,
    system: { stable: stablePrompt(started.firma), context: contextPrompt(started.kontext) },
    firstLine: opening,
  });
  const result = await runCall({
    audio: input.audio,
    stt: input.stt,
    tts: input.tts,
    agent,
    firstLine: opening,
  });
  // The transcript goes in whether or not the agent ended the call itself (a caller who
  // just hangs up); the server scrubs it again and drops it without consent to record.
  const transcript = transcriptText(agent.messages);
  if (transcript) await input.tools.sendTranscript(started.callId, transcript);
  return { ...result, callId: started.callId, agent };
}
