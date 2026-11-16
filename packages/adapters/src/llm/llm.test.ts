import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { ReportFacts } from "@bojen/core";
import {
  REPLY_MODEL,
  REPORT_MODEL,
  POSTCALL_MODEL,
  createClaudeClassifier,
  createClaudeNameplateReader,
  createClaudeSummarizer,
  createClaudeReportWriter,
  createFakeClassifier,
  createFakeNameplateReader,
  createFakeReportWriter,
  createFakeSummarizer,
  createFakeTranscriber,
} from "..";

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

const facts: ReportFacts = {
  service: "Vinterkonservering",
  description: null,
  boat: "Nimbus 3000",
  engines: [{ label: "Volvo Penta D3-220", hours: 412, previousHours: 380 }],
  parts: [{ articleNumber: "21951346", description: "Impeller", quantity: 1, status: "installed" }],
  notes: "Bytt olja. Bälgen sliten.",
  voiceNotes: ["Impellern hade två skadade vingar."],
  photos: 1,
};

describe("Claude report writer", () => {
  it("asks Sonnet 5.5 for a structured draft from the facts of the work only", async () => {
    const draft = {
      workDone: ["Bytt motorolja", "Bytt impeller"],
      recommendations: [{ text: "Byt bälgen", priority: "next_season" }],
      nextService: null,
    };
    const { requests, client } = offlineClient({ text: JSON.stringify(draft) });
    const writer = createClaudeReportWriter({ client });
    expect(writer.name).toBe(REPORT_MODEL);
    expect(await writer.draft(facts)).toEqual(draft);

    const request = requests[0];
    expect(request?.body).toMatchObject({
      model: "claude-sonnet-5-5",
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    const sent = JSON.stringify(request?.body.messages);
    expect(sent).toContain("Bälgen sliten");
    expect(sent).toContain("Impellern hade två skadade vingar");
    expect(sent).not.toMatch(/\+46|07\d/);
  });

  it("gives an empty draft on a refusal, and lets an API error through for a new try", async () => {
    const refused = offlineClient({ text: "", stopReason: "refusal" });
    expect(await createClaudeReportWriter({ client: refused.client }).draft(facts)).toEqual({
      workDone: [],
      recommendations: [],
      nextService: null,
    });
    const failing = new Anthropic({
      apiKey: "test-key-not-real",
      maxRetries: 0,
      fetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error" } }), {
            status: 529,
            headers: { "content-type": "application/json" },
          }),
        )) as unknown as typeof globalThis.fetch,
    });
    await expect(createClaudeReportWriter({ client: failing }).draft(facts)).rejects.toBeInstanceOf(
      Anthropic.APIError,
    );
  });
});

describe("fake report writer and transcriber", () => {
  it("make a draft of the service, installed parts and every sentence, without a model", async () => {
    const writer = createFakeReportWriter();
    expect(await writer.draft(facts)).toEqual({
      workDone: [
        "Utfört: Vinterkonservering",
        "Monterat impeller",
        "Bytt olja",
        "Bälgen sliten",
        "Impellern hade två skadade vingar",
      ],
      recommendations: [],
      nextService: null,
    });
    writer.failNext(1);
    await expect(writer.draft(facts)).rejects.toThrow();
    expect(writer.calls).toHaveLength(2);

    const transcriber = createFakeTranscriber("Hej");
    expect(
      await transcriber.transcribe({ bytes: new Uint8Array([1]), contentType: "audio/webm" }),
    ).toBe("Hej");
    expect(transcriber.calls).toHaveLength(1);
  });
});

describe("after the call (step 6.3)", () => {
  it("summarises the transcript with Sonnet 5.5 in a structured answer", async () => {
    const { requests, client } = offlineClient({
      text: JSON.stringify({
        points: ["Per ringde om Bustern", "Bokade en tid"],
        outcome: "booked",
      }),
    });
    const summarizer = createClaudeSummarizer({ client });
    expect(summarizer.name).toBe(POSTCALL_MODEL);
    expect(await summarizer.summarize("Kund: Hej")).toEqual({
      points: ["Per ringde om Bustern", "Bokade en tid"],
      outcome: "booked",
    });
    expect(requests[0]?.body).toMatchObject({
      model: "claude-sonnet-5-5",
      output_config: { format: { type: "json_schema" } },
    });
    const sent = (requests[0]?.body.messages as { content: string }[])[0]?.content ?? "";
    expect(sent.startsWith("<transcript>")).toBe(true);
    expect(sent).toContain("Kund: Hej");
  });

  it("reads a type plate from the picture, and never sends a picture the API cannot read", async () => {
    const reading = {
      make: "Volvo Penta",
      model: "D4-300",
      serialNumber: "2001234567",
      confidence: 0.92,
    };
    const { requests, client } = offlineClient({ text: JSON.stringify(reading) });
    const reader = createClaudeNameplateReader({ client });
    expect(
      await reader.read({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }),
    ).toEqual(reading);
    const content = (
      requests[0]?.body.messages as { content: { type: string; source?: unknown }[] }[]
    )[0]?.content;
    expect(content?.[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AQID" },
    });
    expect(
      await reader.read({ bytes: new Uint8Array([1]), contentType: "image/heic" }),
    ).toMatchObject({
      confidence: 0,
    });
    expect(requests).toHaveLength(1);
  });

  it("has fakes that summarise the caller's lines and read every plate the same", async () => {
    const summarizer = createFakeSummarizer();
    expect(await summarizer.summarize("Kund: A\nReceptionist: B\nKund: C")).toEqual({
      points: ["A", "C"],
      outcome: null,
    });
    const reader = createFakeNameplateReader();
    expect(
      await reader.read({ bytes: new Uint8Array([1]), contentType: "image/png" }),
    ).toMatchObject({
      make: "Volvo Penta",
    });
    expect(reader.calls).toHaveLength(1);
  });
});
