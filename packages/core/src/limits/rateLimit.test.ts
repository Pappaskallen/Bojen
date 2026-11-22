import { describe, expect, it } from "vitest";
import { PUBLIC_BOOKING_LIMITS, createRateLimiter } from "./rateLimit";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 22, 10, 0, seconds));

describe("createRateLimiter", () => {
  it("lets max requests through in the window and says when to try again", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });
    expect(limiter.take("a", at(0))).toEqual({ ok: true });
    expect(limiter.take("a", at(10))).toEqual({ ok: true });
    expect(limiter.take("a", at(20))).toEqual({ ok: true });
    expect(limiter.take("a", at(30))).toEqual({ ok: false, retryAfterSeconds: 30 });
    // Another caller has its own count.
    expect(limiter.take("b", at(30))).toEqual({ ok: true });
  });

  it("slides: the oldest request leaves the window first", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    limiter.take("a", at(0));
    limiter.take("a", at(40));
    expect(limiter.take("a", at(59)).ok).toBe(false);
    expect(limiter.take("a", at(60)).ok).toBe(true);
    expect(limiter.take("a", at(61))).toEqual({ ok: false, retryAfterSeconds: 39 });
  });

  it("refused requests do not count, so waiting is enough", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 10_000 });
    limiter.take("a", at(0));
    for (let s = 1; s < 10; s += 1) expect(limiter.take("a", at(s)).ok).toBe(false);
    expect(limiter.take("a", at(10)).ok).toBe(true);
  });

  it("keeps memory bounded by forgetting the callers not seen for longest", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 3_600_000 }, { maxKeys: 3 });
    for (const key of ["a", "b", "c", "d"]) limiter.take(key, at(0));
    // "a" was forgotten, "d" was not.
    expect(limiter.take("a", at(1)).ok).toBe(true);
    expect(limiter.take("d", at(1)).ok).toBe(false);
  });
});

describe("PUBLIC_BOOKING_LIMITS", () => {
  it("is strictest where an sms or a booking is made", () => {
    expect(PUBLIC_BOOKING_LIMITS.code.max).toBeLessThanOrEqual(5);
    expect(PUBLIC_BOOKING_LIMITS.book.max).toBeLessThanOrEqual(5);
    expect(PUBLIC_BOOKING_LIMITS.address.max).toBeGreaterThan(PUBLIC_BOOKING_LIMITS.code.max);
  });
});
