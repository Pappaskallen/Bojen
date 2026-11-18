import {
  createFakeCallAudio,
  createFakeConversation,
  createFakeSpeechToText,
  createFakeTextToSpeech,
} from "@bojen/adapters";
import type { ModelTurn } from "@bojen/core";
import { describe, expect, it, vi } from "vitest";
import { FALLBACK_LINE, MAX_TOOL_ROUNDS, createCallAgent } from "./agent";
import { handleCall } from "./call";
import { contextPrompt, firstLine, stablePrompt, type FirmFacts } from "./prompt";
import { runCall } from "./session";
import { createToolsClient, type ToolsClient } from "./tools-client";

const FIRM: FirmFacts = {
  firma: "Jonas Båtservice",
  assistentNamn: "Bojen",
  halsning: null,
  mekaniker: "Jonas",
  serviceomrade: "Värmdö och Nacka",
  ejServiceomraden: ["Arholma"],
  oppettider: "vardagar 07–17",
  jourtider: "ingen jour",
  svarslofte: "nästa vardag före klockan tio",
  timpris: 950,
  akuttillagg: 1800,
  tjanster: [{ id: "s1", namn: "Felsökning", minuter: 60, krav: null, pris: 950 }],
  platser: [{ id: "l1", namn: "Bullandö Marina", typ: "marina" }],
};

const text = (t: string): ModelTurn => ({
  stopReason: "end_turn",
  content: [{ type: "text", text: t }],
});
const tool = (name: string, input: unknown, say = ""): ModelTurn => ({
  stopReason: "tool_use",
  content: [
    ...(say ? [{ type: "text" as const, text: say }] : []),
    { type: "tool_use" as const, id: `tu_${name}`, name, input },
  ],
});

function tools(
  answers: Record<string, unknown> = {},
): ToolsClient & { calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    startCall: () => Promise.resolve(null),
    sendTranscript: () => Promise.resolve(),
    run: (_token, name, input) => {
      calls.push([name, input]);
      return Promise.resolve(answers[name] ?? { ok: true });
    },
  };
}

function agent(model: ReturnType<typeof createFakeConversation>, client = tools()) {
  return createCallAgent({
    model,
    tools: client,
    token: "call-token",
    definitions: [{ name: "hamta_bokningar", description: "Coming visits", input_schema: {} }],
    system: { stable: stablePrompt(FIRM), context: contextPrompt({ kand: false }) },
    firstLine: firstLine(FIRM),
  });
}

describe("the system prompt", () => {
  it("is spec 8.2 with the firm's facts, every placeholder filled, and the caller's context apart", () => {
    const prompt = stablePrompt(FIRM);
    expect(prompt).toContain("Du är Bojen, digital receptionist för Jonas Båtservice");
    expect(prompt).toContain("Felsökning: 950 kronor exklusive moms");
    expect(prompt).toContain("Akuttillägg: 1800 kronor plus ordinarie timpris");
    expect(prompt).toContain("s1: Felsökning, 60 minuter");
    expect(prompt).toContain("l1: Bullandö Marina");
    expect(prompt).toContain("Vi åker inte till: Arholma");
    expect(prompt).toContain("bekrafta_kund");
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(prompt).not.toContain("Kundkontext (från systemet");
    expect(contextPrompt({ kand: true, kund: { fornamn: "Per" } })).toMatch(
      /^# Kundkontext.*\n\{"kand":true/,
    );
  });

  it("opens with the spec's first line, word for word", () => {
    expect(firstLine(FIRM)).toBe(
      "Hej och välkommen till Jonas Båtservice. Jag är Jonas Båtservices digitala assistent, och samtalet spelas in så att vi kan hjälpa dig. Vad gäller det?",
    );
  });
});

describe("the tools client", () => {
  it("starts the call with the service's secret and runs tools with the call's token", async () => {
    const requests: { url: string; auth: string | null; body: unknown }[] = [];
    const fetch = vi.fn((url: string, init: RequestInit) => {
      requests.push({
        url,
        auth: new Headers(init.headers).get("authorization"),
        body: JSON.parse(String(init.body)),
      });
      if (url.endsWith("/samtal"))
        return Promise.resolve(
          Response.json({ token: "t", firma: FIRM, kontext: {}, verktyg: [] }, { status: 201 }),
        );
      if (url.endsWith("/hamta_bokningar")) return Promise.resolve(Response.json({ besok: [] }));
      return Promise.resolve(new Response(null, { status: 401 }));
    }) as unknown as typeof globalThis.fetch;
    const client = createToolsClient({
      baseUrl: "http://localhost:3000/",
      serviceSecret: "service",
      fetch,
    });
    expect(await client.startCall({ to: "+46766860011", from: null })).toMatchObject({
      token: "t",
    });
    expect(await client.run("t", "hamta_bokningar", {})).toEqual({ besok: [] });
    // A refused token is something the model can say, not an exception.
    expect(await client.run("t", "skapa_bokning", {})).toEqual({ fel: "samtalet_har_gatt_ut" });
    expect(requests.map((r) => [r.url, r.auth])).toEqual([
      ["http://localhost:3000/api/voice-tools/samtal", "Bearer service"],
      ["http://localhost:3000/api/voice-tools/hamta_bokningar", "Bearer t"],
      ["http://localhost:3000/api/voice-tools/skapa_bokning", "Bearer t"],
    ]);
  });
});

describe("the agent", () => {
  it("runs the tools the model calls and answers with what it then says", async () => {
    const client = tools({ hamta_bokningar: { besok: [{ id: "v1", dag: "2027-04-20" }] } });
    const model = createFakeConversation([
      tool("hamta_bokningar", {}, "Ett ögonblick."),
      text("Du har en tid tisdag tjugonde april."),
    ]);
    const a = agent(model, client);
    expect(await a.reply("När kommer ni?")).toBe(
      "Ett ögonblick. Du har en tid tisdag tjugonde april.",
    );
    expect(client.calls).toEqual([["hamta_bokningar", {}]]);
    // The first turn carries the system's own first line, then the caller's words.
    expect(model.calls[0]?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(model.calls[0]?.messages[1]?.content).toBe(firstLine(FIRM));
    // The second sees the tool's answer.
    const last = model.calls[1]?.messages.at(-1);
    expect(last).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_hamta_bokningar" }],
    });
    expect(a.messages).toHaveLength(6);
  });

  it("marks a refused tool as an error, never runs tools from a refused turn, and stops runaway loops", async () => {
    const client = tools({ avboka_bokning: { fel: "kontroll_kravs" } });
    const model = createFakeConversation([
      tool("avboka_bokning", { besok_id: "v1" }),
      text("Vad heter båten?"),
    ]);
    const a = agent(model, client);
    await a.reply("Avboka min tid");
    const result = model.calls[1]?.messages.at(-1)?.content as { is_error?: boolean }[];
    expect(result[0]?.is_error).toBe(true);

    const refused = agent(
      createFakeConversation([
        {
          stopReason: "refusal",
          content: [{ type: "tool_use", id: "x", name: "avboka_bokning", input: {} }],
        },
      ]),
      client,
    );
    expect(await refused.reply("hej")).toBe(FALLBACK_LINE);
    expect(client.calls.filter(([n]) => n === "avboka_bokning")).toHaveLength(1);

    const looping = createFakeConversation(() => tool("hamta_bokningar", {}));
    expect(await agent(looping).reply("hej")).toBe(FALLBACK_LINE);
    expect(looping.calls).toHaveLength(MAX_TOOL_ROUNDS);
  });

  it("ends when the model ends the call, and keeps what a tool did when the caller interrupts", async () => {
    const ending = agent(
      createFakeConversation([
        tool("avsluta_samtal", { sammanfattning: "x", utfall: "spam" }, "Tack, hej då."),
      ]),
    );
    expect(await ending.reply("Jag säljer solpaneler")).toBe("Tack, hej då.");
    expect(ending.ended).toBe(true);
    expect(await ending.reply("hallå?")).toBe("");

    const controller = new AbortController();
    const client = tools({ skapa_bokning: { besok_id: "v9" } });
    const slow = createFakeConversation(
      [tool("skapa_bokning", { tid_id: "t" }), text("Klart, du är bokad.")],
      { delayMs: 30 },
    );
    const a = agent(slow, client);
    const answer = a.reply("Ja, boka den", {
      signal: controller.signal,
      onText: () => controller.abort(),
    });
    expect(await answer).toBe("");
    expect(client.calls).toEqual([["skapa_bokning", { tid_id: "t" }]]);
    // The booking is in the history, so the model knows it next turn.
    expect(JSON.stringify(a.messages)).toContain("v9");
  });
});

describe("a call", () => {
  it("speaks the first line, answers sentence by sentence, measures each turn and hangs up at the end", async () => {
    const tts = createFakeTextToSpeech();
    const audio = createFakeCallAudio();
    let clock = 0;
    const model = createFakeConversation([
      text("Hej Per! Gäller det Nimbusen på Bullandö?"),
      tool(
        "avsluta_samtal",
        { sammanfattning: "Frågade om tid", utfall: "message" },
        "Tack, hej då.",
      ),
    ]);
    const result = await runCall({
      audio,
      stt: createFakeSpeechToText(
        [
          { text: "hej det", final: false },
          { text: "Hej det är Per", final: true },
          { text: "Nej tack, hej", final: true },
        ],
        { delayMs: 20 },
      ),
      tts,
      agent: agent(model),
      firstLine: firstLine(FIRM),
      now: () => (clock += 100),
    });
    expect(audio.heard).toEqual([
      firstLine(FIRM),
      "Hej Per!",
      "Gäller det Nimbusen på Bullandö?",
      "Tack, hej då.",
    ]);
    expect(result.turns.map((t) => t.caller)).toEqual(["Hej det är Per", "Nej tack, hej"]);
    expect(result.latencies).toHaveLength(2);
    expect(result.p90).not.toBeNull();
    expect(audio.hungUp).toBe(true);
  });

  it("stops talking when the caller talks over it (barge-in)", async () => {
    const tts = createFakeTextToSpeech({ delayMs: 40 });
    const audio = createFakeCallAudio();
    const model = createFakeConversation(
      [
        text("Vi har tider på tisdag, onsdag och torsdag. Vilken passar?"),
        text("Onsdag, då bokar jag den."),
      ],
      { delayMs: 5 },
    );
    const result = await runCall({
      audio,
      stt: createFakeSpeechToText(
        [
          { text: "Vilka tider har ni", final: true },
          { text: "onsdag", final: false },
          { text: "Onsdag", final: true },
        ],
        { delayMs: 30 },
      ),
      tts,
      agent: agent(model),
      firstLine: firstLine(FIRM),
    });
    expect(result.turns[0]).toMatchObject({ caller: "Vilka tider har ni", interrupted: true });
    expect(audio.heard).not.toContain("Vilken passar?");
    expect(audio.heard.at(-1)).toBe("Onsdag, då bokar jag den.");
  });
});

describe("a whole call", () => {
  it("starts with the tool API, runs, and hands in the transcript without card numbers", async () => {
    const sent: [string, string][] = [];
    const client: ToolsClient = {
      startCall: () =>
        Promise.resolve({
          callId: "c1",
          token: "t",
          expiresAt: "2027-04-20T09:00:00Z",
          firma: FIRM,
          kontext: { kand: false },
          verktyg: [],
        }),
      run: () => Promise.resolve({ ok: true }),
      sendTranscript: (callId, transcript) => {
        sent.push([callId, transcript]);
        return Promise.resolve();
      },
    };
    const audio = createFakeCallAudio();
    const result = await handleCall({
      tools: client,
      model: createFakeConversation([text("Kort tar vi inte emot i telefon.")]),
      stt: createFakeSpeechToText([{ text: "Mitt kort är 4111 1111 1111 1111", final: true }]),
      tts: createFakeTextToSpeech(),
      audio,
      to: "+46766860011",
      from: "+46701119601",
    });
    expect(result?.callId).toBe("c1");
    expect(sent).toEqual([
      [
        "c1",
        `Receptionist: ${firstLine(FIRM)}\nKund: Mitt kort är [kortnummer]\nReceptionist: Kort tar vi inte emot i telefon.`,
      ],
    ]);
  });

  it("hangs up on a number that is no firm's", async () => {
    const audio = createFakeCallAudio();
    expect(
      await handleCall({
        tools: { ...tools(), startCall: () => Promise.resolve(null) },
        model: createFakeConversation([]),
        stt: createFakeSpeechToText([]),
        tts: createFakeTextToSpeech(),
        audio,
        to: "+46700000000",
        from: null,
      }),
    ).toBeNull();
    expect(audio.hungUp).toBe(true);
  });
});
