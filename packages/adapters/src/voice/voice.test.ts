import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  VOICE_MODEL,
  createClaudeConversation,
  createFakeCallAudio,
  createFakeConversation,
  createFakeSpeechToText,
  createFakeTextToSpeech,
} from "..";

/** A streamed answer as the Messages API sends it: text, then a tool call. */
function sse(events: Record<string, unknown>[]) {
  const body = events
    .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function streamingClient() {
  const requests: Record<string, unknown>[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return sse([
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: VOICE_MODEL,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Ett ögonblick. " },
      },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Jag kollar." } },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tu_1", name: "hamta_bokningar", input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: "{}" },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 12 },
      },
      { type: "message_stop" },
    ]);
  }) as unknown as typeof globalThis.fetch;
  return { requests, client: new Anthropic({ apiKey: "test-key-not-real", fetch, maxRetries: 0 }) };
}

describe("Claude in the call", () => {
  it("streams Haiku 5.5 at effort low without thinking, the firm's prompt cached and the caller's last", async () => {
    const { requests, client } = streamingClient();
    const deltas: string[] = [];
    const turn = await createClaudeConversation({ client }).turn({
      system: { stable: "FIRMANS PROMPT", context: "KUNDKONTEXT" },
      tools: [
        {
          name: "hamta_bokningar",
          description: "Coming visits",
          input_schema: { type: "object", properties: {} },
        },
      ],
      messages: [{ role: "user", content: "När kommer ni?" }],
      onText: (d) => deltas.push(d),
    });
    expect(deltas.join("")).toBe("Ett ögonblick. Jag kollar.");
    expect(turn).toEqual({
      stopReason: "tool_use",
      content: [
        { type: "text", text: "Ett ögonblick. Jag kollar." },
        { type: "tool_use", id: "tu_1", name: "hamta_bokningar", input: {} },
      ],
    });
    expect(requests[0]).toMatchObject({
      model: "claude-haiku-5-5",
      stream: true,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: [
        { type: "text", text: "FIRMANS PROMPT", cache_control: { type: "ephemeral" } },
        { type: "text", text: "KUNDKONTEXT" },
      ],
      tools: [{ name: "hamta_bokningar", eager_input_streaming: true }],
    });
    // The caller's context is after the cache breakpoint, never in the cached part.
    const system = requests[0]?.system as { text: string; cache_control?: unknown }[];
    expect(system.findIndex((b) => b.text === "KUNDKONTEXT")).toBe(1);
    expect(system[1]?.cache_control).toBeUndefined();
  });
});

describe("the voice fakes", () => {
  it("script the model, hear the transcripts, speak the text and play it", async () => {
    const model = createFakeConversation([
      { stopReason: "end_turn", content: [{ type: "text", text: "Hej då." }] },
    ]);
    const words: string[] = [];
    expect(
      await model.turn({
        system: { stable: "", context: "" },
        tools: [],
        messages: [],
        onText: (w) => words.push(w),
      }),
    ).toMatchObject({ stopReason: "end_turn" });
    expect(words.join("")).toBe("Hej då.");
    await expect(
      model.turn({ system: { stable: "", context: "" }, tools: [], messages: [] }),
    ).rejects.toThrow();

    const heard: string[] = [];
    for await (const t of createFakeSpeechToText([{ text: "hej", final: true }]).transcripts(
      (async function* () {})(),
    )) {
      heard.push(t.text);
    }
    expect(heard).toEqual(["hej"]);

    const tts = createFakeTextToSpeech();
    const audio = createFakeCallAudio();
    await audio.play(tts.synthesize("Välkommen."));
    expect(tts.said).toEqual(["Välkommen."]);
    expect(audio.heard).toEqual(["Välkommen."]);
    await audio.hangUp();
    expect(audio.hungUp).toBe(true);
  });
});
