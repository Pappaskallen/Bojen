import { incomingRoute } from "@bojen/core";
import { describe, expect, it } from "vitest";
import { createFakePush } from "../push/fake";
import { elksCallActions, parseElksIncomingCall, parseElksRecording } from "./voice";

const targets = {
  agentSip: "sip:bojen@sip.example",
  mechanic: "+46701234567",
  voicemailUrl: "https://bojen.app/api/webhooks/elks/rostbrevlada?token=t",
};
const voicemail = {
  play: "sound/beep",
  next: { record: targets.voicemailUrl, timelimit: "120" },
};

describe("incoming calls through 46elks", () => {
  it("try the agent, then the mechanic, then the voicemail", () => {
    const mechanic = { connect: "+46701234567", timeout: "25", failed: voicemail, busy: voicemail };
    expect(
      elksCallActions(incomingRoute({ agentUp: true, mechanic: targets.mechanic }), targets),
    ).toEqual({
      connect: "sip:bojen@sip.example",
      timeout: "10",
      failed: mechanic,
      busy: mechanic,
    });
  });

  it("go straight to the mechanic when the agent is down (K10)", () => {
    expect(
      elksCallActions(incomingRoute({ agentUp: false, mechanic: targets.mechanic }), targets),
    ).toMatchObject({ connect: "+46701234567", failed: voicemail });
    expect(elksCallActions(["agent", "voicemail"], { ...targets, agentSip: null })).toEqual(
      voicemail,
    );
  });

  it("read what 46elks posts, and only fetch its own recordings", () => {
    expect(
      parseElksIncomingCall(
        new URLSearchParams({ callid: "c1", from: "+46709999999", to: "+46812345" }),
      ),
    ).toEqual({ callId: "c1", from: "+46709999999", to: "+46812345" });
    expect(
      parseElksIncomingCall(
        new URLSearchParams({ callid: "c1", from: "anonymous", to: "+46812345" }),
      ),
    ).toMatchObject({ from: null });
    const form = (wav: string) =>
      new URLSearchParams({
        callid: "c1",
        from: "+46709999999",
        to: "+46812345",
        wav,
        duration: "14",
      });
    expect(parseElksRecording(form("https://api.46elks.com/a1/recordings/r1.wav"))).toMatchObject({
      seconds: 14,
    });
    expect(parseElksRecording(form("https://evil.example/r1.wav"))).toBeNull();
    expect(parseElksRecording(form("http://api.46elks.com/r1.wav"))).toBeNull();
  });
});

describe("the fake push", () => {
  it("keeps what was sent and answers gone for dropped subscriptions", async () => {
    const push = createFakePush();
    const payload = { title: "Akut", body: "x", url: "/idag/arenden", urgent: true, tag: "t" };
    expect(await push.send({ endpoint: "e1", p256dh: "k", auth: "a" }, payload)).toEqual({
      gone: false,
    });
    push.gone.add("e2");
    expect(await push.send({ endpoint: "e2", p256dh: "k", auth: "a" }, payload)).toEqual({
      gone: true,
    });
    expect(push.sent).toEqual([{ endpoint: "e1", payload }]);
  });
});
