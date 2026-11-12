import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { REPLY_MODEL, createClaudeClassifier, createFakeClassifier } from "..";

/** A Claude client whose HTTP calls go to `answer` instead of the network. */
function offlineClient(answer: { text: string; stopReason?: string }) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: REPLY_MODEL,
        content: [{ type: "text", text: answer.text }],
        stop_reason: answer.stopReason ?? "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof globalThis.fetch;
  return { requests, client: new Anthropic({ apiKey: "test-key-not-real", fetch, maxRetries: 0 }) };
}

describe("Claude reply classifier", () => {
  it("asks Sonnet 5.5 for a structured answer with only the reply and the question", async () => {
    const { requests, client } = offlineClient({
      text: JSON.stringify({ intent: "change", confidence: 0.82, rating: null }),
    });
    const answer = await createClaudeClassifier({ client }).classify({
      reply: "Ja men nyckeln ligger hos grannen",
      question: "availability_check",
      allowed: ["yes", "no", "change", "stop", "unclear"],
    });
    expect(answer).toEqual({ intent: "change", confidence: 0.82, rating: null });

    const request = requests[0];
    expect(request?.url).toContain("/v1/messages");
    expect(request?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(request?.body).toMatchObject({
      model: "claude-sonnet-5-5",
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    const sent = JSON.stringify(request?.body.messages);
    expect(sent).toContain("Ja men nyckeln ligger hos grannen");
    expect(sent).toContain("yes, no, change, stop, unclear");
    expect(sent).not.toMatch(/\+46|07\d/);
  });

  it("a refusal or an answer that cannot be parsed is unclear", async () => {
    const refused = offlineClient({ text: "", stopReason: "refusal" });
    expect(
      await createClaudeClassifier({ client: refused.client }).classify({
        reply: "x",
        question: "none",
        allowed: ["stop", "unclear"],
      }),
    ).toMatchObject({ intent: "unclear", confidence: 0 });
  });
});

describe("fake classifier", () => {
  it("answers from its table and records the calls", async () => {
    const fake = createFakeClassifier();
    fake.answer("Kan ni komma på torsdag?", { intent: "change", confidence: 0.95 });
    const input = { question: "availability_check" as const, allowed: ["change" as const] };
    expect(await fake.classify({ ...input, reply: "Kan ni komma på torsdag?" })).toEqual({
      intent: "change",
      confidence: 0.95,
    });
    expect(await fake.classify({ ...input, reply: "något annat" })).toEqual({
      intent: "unclear",
      confidence: 0,
    });
    expect(fake.calls).toHaveLength(2);
  });
});
