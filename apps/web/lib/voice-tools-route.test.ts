import { openCallToken, sealCallToken, VOICE_TOOL_NAMES } from "@bojen/core";
import type { CallRow } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createVoiceToolsRoute, type VoiceToolsDeps } from "./voice-tools-route";

const SERVICE = "voice-service-secret-that-is-long-enough-1";
const TOKEN_SECRET = "voice-token-secret-that-is-long-enough-12";
const NOW = new Date("2027-04-20T08:00:00Z");
const CALL = { id: "c1", tenantId: "t1", endedAt: null } as unknown as CallRow;

function route(over: Partial<VoiceToolsDeps> = {}) {
  const deps: VoiceToolsDeps = {
    serviceSecret: () => SERVICE,
    tokenSecret: () => TOKEN_SECRET,
    now: () => NOW,
    start: vi.fn(() =>
      Promise.resolve({ callId: "c1", tenantId: "t1", expiresAt: NOW.getTime() + 3_600_000 }),
    ),
    openCall: vi.fn(() => Promise.resolve(CALL)),
    context: vi.fn(() => Promise.resolve({ kand: true, kund: { id: "k1", fornamn: "Per" } })),
    facts: vi.fn(() =>
      Promise.resolve({
        firma: "Jonas Båtservice",
        assistentNamn: "Bojen",
        halsning: null,
        mekaniker: "Jonas",
        serviceomrade: "Värmdö",
        ejServiceomraden: [],
        oppettider: "vardagar 07–17",
        jourtider: "ingen jour",
        svarslofte: "inom en dag",
        timpris: 950,
        akuttillagg: 1800,
        tjanster: [],
        platser: [],
      }),
    ),
    run: vi.fn(() => Promise.resolve({ ok: true })),
    saveTranscript: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  return { deps, r: createVoiceToolsRoute(deps) };
}

const post = (path: string, auth: string | null, body: unknown) =>
  new Request(`http://localhost/api/voice-tools/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
const token = (expiresAt = NOW.getTime() + 60_000) =>
  sealCallToken(TOKEN_SECRET, { callId: "c1", tenantId: "t1", expiresAt });

describe("starting a call", () => {
  it("gives the voice agent the call's token, the customer context and the tools", async () => {
    const { deps, r } = route();
    const response = await r.startCall(
      post("samtal", SERVICE, { to: "+46766860011", from: "+46701119601", externalId: "elks-1" }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      token: string;
      kontext: unknown;
      firma: unknown;
      verktyg: { name: string }[];
    };
    expect(openCallToken(TOKEN_SECRET, body.token, NOW)).toMatchObject({
      callId: "c1",
      tenantId: "t1",
    });
    expect(body.kontext).toEqual({ kand: true, kund: { id: "k1", fornamn: "Per" } });
    expect(body.firma).toMatchObject({ firma: "Jonas Båtservice", mekaniker: "Jonas" });
    expect(body.verktyg.map((t) => t.name)).toEqual([...VOICE_TOOL_NAMES]);
    expect(deps.start).toHaveBeenCalledWith({
      to: "+46766860011",
      from: "+46701119601",
      externalId: "elks-1",
    });
  });

  it("is only for the voice agent's secret, and only for a firm's number", async () => {
    const { deps, r } = route();
    expect((await r.startCall(post("samtal", null, { to: "+46766860011" }))).status).toBe(401);
    expect((await r.startCall(post("samtal", `${SERVICE}x`, { to: "+46766860011" }))).status).toBe(
      401,
    );
    // A call token is not the service's secret.
    expect((await r.startCall(post("samtal", token(), { to: "+46766860011" }))).status).toBe(401);
    expect(deps.start).not.toHaveBeenCalled();
    const unset = route({ serviceSecret: () => null });
    expect((await unset.r.startCall(post("samtal", SERVICE, { to: "x" }))).status).toBe(401);
    const unknown = route({ start: () => Promise.resolve(null) });
    expect((await unknown.r.startCall(post("samtal", SERVICE, { to: "+4670" }))).status).toBe(404);
    expect((await r.startCall(post("samtal", SERVICE, {}))).status).toBe(400);
  });
});

describe("a tool", () => {
  it("runs for the call its token names, with the model's input", async () => {
    const { deps, r } = route();
    const response = await r.tool(post("hitta_kund", token(), { telefon: "070" }), "hitta_kund");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deps.openCall).toHaveBeenCalledWith("t1", "c1");
    expect(deps.run).toHaveBeenCalledWith("hitta_kund", CALL, { telefon: "070" });
  });

  it("is refused without a valid token, after it expires, and once the call has ended", async () => {
    const { deps, r } = route();
    for (const auth of [null, "nonsense", SERVICE, token(NOW.getTime())]) {
      expect((await r.tool(post("hamta_bokningar", auth, {}), "hamta_bokningar")).status).toBe(401);
    }
    const forged = sealCallToken("another-secret-that-is-long-enough-12345", {
      callId: "c1",
      tenantId: "t1",
      expiresAt: NOW.getTime() + 60_000,
    });
    expect((await r.tool(post("hamta_bokningar", forged, {}), "hamta_bokningar")).status).toBe(401);
    const ended = route({ openCall: () => Promise.resolve(null) });
    expect(
      (await ended.r.tool(post("hamta_bokningar", token(), {}), "hamta_bokningar")).status,
    ).toBe(401);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("is only one of the spec's tools", async () => {
    const { deps, r } = route();
    expect((await r.tool(post("las_kod", token(), {}), "las_kod")).status).toBe(404);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("fails without the caller's words in the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { r } = route({
      run: () => Promise.reject(new Error("Per Persson 0701119601 sa koden 1234")),
    });
    const response = await r.tool(
      post("skapa_meddelande", token(), { text: "koden är 1234" }),
      "skapa_meddelande",
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/1234|Persson|0701119601/);
    log.mockRestore();
  });
});

describe("the transcript after the call", () => {
  const CALL_ID = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";

  it("is taken from the voice agent with its secret, for a call that exists", async () => {
    const { deps, r } = route();
    const response = await r.transcript(
      post("transkript", SERVICE, { callId: CALL_ID, transkript: "Kund: Hej" }),
    );
    expect(response.status).toBe(204);
    expect(deps.saveTranscript).toHaveBeenCalledWith(CALL_ID, "Kund: Hej");
    const unknown = route({ saveTranscript: () => Promise.resolve(false) });
    const missing = await unknown.r.transcript(
      post("transkript", SERVICE, { callId: CALL_ID, transkript: "x" }),
    );
    expect(missing.status).toBe(404);
  });

  it("is refused with a call's token, without a secret, or without text", async () => {
    const { deps, r } = route();
    for (const auth of [null, token()]) {
      const refused = await r.transcript(
        post("transkript", auth, { callId: CALL_ID, transkript: "x" }),
      );
      expect(refused.status).toBe(401);
    }
    const badId = await r.transcript(post("transkript", SERVICE, { callId: "x", transkript: "x" }));
    expect(badId.status).toBe(400);
    const empty = await r.transcript(
      post("transkript", SERVICE, { callId: CALL_ID, transkript: " " }),
    );
    expect(empty.status).toBe(400);
    expect(deps.saveTranscript).not.toHaveBeenCalled();
  });
});
