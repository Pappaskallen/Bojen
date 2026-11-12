import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { standardWebhookValid, tokenMatches } from "./webhook";

const key = Buffer.from("a-local-test-secret-for-the-hook");
const secret = `v1,whsec_${key.toString("base64")}`;
const now = new Date("2026-11-12T10:00:00Z");
const timestamp = String(now.getTime() / 1000);
const body = JSON.stringify({ user: { id: "u1", phone: "46701740605" }, sms: { otp: "123456" } });
const sign = (k: Buffer, id: string, ts: string, b: string) =>
  `v1,${createHmac("sha256", k).update(`${id}.${ts}.${b}`).digest("base64")}`;

describe("standardWebhookValid", () => {
  const valid = {
    secret,
    id: "msg_1",
    timestamp,
    body,
    now,
    signature: sign(key, "msg_1", timestamp, body),
  };

  it("accepts the right signature", () => {
    expect(standardWebhookValid(valid)).toBe(true);
    // One of several signatures is enough (Standard Webhooks allows key rotation).
    expect(standardWebhookValid({ ...valid, signature: `v1,AAAA ${valid.signature}` })).toBe(true);
  });

  it.each([
    ["another body", { body: body.replace("123456", "654321") }],
    ["another id", { id: "msg_2" }],
    ["another key", { signature: sign(Buffer.from("wrong"), "msg_1", timestamp, body) }],
    ["no signature", { signature: null }],
    ["too old", { now: new Date(now.getTime() + 6 * 60_000) }],
    ["from the future", { now: new Date(now.getTime() - 6 * 60_000) }],
    ["no secret", { secret: "v1,whsec_" }],
    ["another version", { signature: valid.signature.replace("v1,", "v2,") }],
  ])("refuses %s", (_, change) => {
    expect(standardWebhookValid({ ...valid, ...change })).toBe(false);
  });
});

describe("tokenMatches", () => {
  it("matches only the exact token", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
    expect(tokenMatches("abc124", "abc123")).toBe(false);
    expect(tokenMatches("abc", "abc123")).toBe(false);
    expect(tokenMatches(null, "abc123")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});
