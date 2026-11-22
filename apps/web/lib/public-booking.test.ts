import { createRateLimiter, type PublicBookingAction, type RateLimiter } from "@bojen/core";
import { describe, expect, it } from "vitest";
import { createPublicRoutes } from "./public-booking";

const now = new Date("2026-11-22T10:00:00Z");

function routes(limits: Record<PublicBookingAction, RateLimiter> | null) {
  const dbCalls: string[] = [];
  const r = createPublicRoutes({
    db: () => {
      dbCalls.push("db");
      throw new Error("no database in this test");
    },
    sms: () => {
      throw new Error("unused");
    },
    maps: () => {
      throw new Error("unused");
    },
    geocoder: () => {
      throw new Error("unused");
    },
    storage: () => {
      throw new Error("unused");
    },
    now: () => now,
    sessionSecret: () => "s".repeat(32),
    limits,
  });
  return { r, dbCalls };
}

const refuseAll: RateLimiter = { take: () => ({ ok: false, retryAfterSeconds: 42 }) };
const every = (limiter: RateLimiter) => ({
  code: limiter,
  verify: limiter,
  address: limiter,
  suggestions: limiter,
  book: limiter,
});

const post = (ip: string) =>
  new Request("http://bojen.test/api/boka/firma/code", {
    method: "POST",
    headers: { "x-real-ip": ip, "content-type": "application/json" },
    body: JSON.stringify({ phone: "0701234567" }),
  });

describe("the public booking's limits", () => {
  it("answers 429 with Retry-After before the firm is looked up", async () => {
    const { r, dbCalls } = routes(every(refuseAll));
    for (const answer of [
      await r.code(post("203.0.113.5"), "firma"),
      await r.verify(post("203.0.113.5"), "firma"),
      await r.address(new Request("http://bojen.test/api/boka/firma/address?q=Brygg"), "firma"),
      await r.suggestions(post("203.0.113.5"), "firma"),
      await r.book(post("203.0.113.5"), "firma"),
    ]) {
      expect(answer.status).toBe(429);
      expect(answer.headers.get("retry-after")).toBe("42");
      expect(await answer.json()).toEqual({ error: "too_many_requests" });
    }
    expect(dbCalls).toEqual([]);
  });

  it("counts per address and per action", async () => {
    const one = () => createRateLimiter({ max: 1, windowMs: 60_000 });
    const { r, dbCalls } = routes({
      code: one(),
      verify: one(),
      address: one(),
      suggestions: one(),
      book: one(),
    });
    // The first request from an address goes on to the firm (here: the database that throws).
    await expect(r.code(post("203.0.113.5"), "firma")).rejects.toThrow("no database");
    expect((await r.code(post("203.0.113.5"), "firma")).status).toBe(429);
    await expect(r.code(post("198.51.100.7"), "firma")).rejects.toThrow("no database");
    await expect(r.verify(post("203.0.113.5"), "firma")).rejects.toThrow("no database");
    expect(dbCalls).toHaveLength(3);
  });

  it("has no limits when none are given (the end-to-end tests)", async () => {
    const { r } = routes(null);
    for (let i = 0; i < 3; i += 1) {
      await expect(r.code(post("203.0.113.5"), "firma")).rejects.toThrow("no database");
    }
  });
});
