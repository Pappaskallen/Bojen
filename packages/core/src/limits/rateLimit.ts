/**
 * How often one caller may use an open endpoint (ASVS V11.1.4, sakerhet-asvs.md). A sliding
 * window per key, kept in memory: Bojen runs one web process on its own server, so one count
 * is the whole truth, and a restart only forgives a few requests. No I/O; the caller gives
 * the time.
 */

export interface Limit {
  /** Requests allowed in the window. */
  max: number;
  windowMs: number;
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  take(key: string, now: Date): LimitResult;
}

export function createRateLimiter(limit: Limit, options: { maxKeys?: number } = {}): RateLimiter {
  const maxKeys = options.maxKeys ?? 20_000;
  const hits = new Map<string, number[]>();

  function prune(now: number) {
    for (const [key, times] of hits) {
      const kept = times.filter((t) => now - t < limit.windowMs);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }

  return {
    take(key, at) {
      const now = at.getTime();
      const times = (hits.get(key) ?? []).filter((t) => now - t < limit.windowMs);
      if (times.length >= limit.max) {
        hits.set(key, times);
        const oldest = times[0] ?? now;
        return {
          ok: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + limit.windowMs - now) / 1000)),
        };
      }
      times.push(now);
      hits.delete(key);
      hits.set(key, times);
      if (hits.size > maxKeys) {
        prune(now);
        // Still too many callers: forget the ones not seen for longest (a Map keeps order).
        for (const old of hits.keys()) {
          if (hits.size <= maxKeys) break;
          hits.delete(old);
        }
      }
      return { ok: true };
    },
  };
}

/** The public booking page's limits per IP address (byggplan step 2.5, ASVS V11.1.4). */
export const PUBLIC_BOOKING_LIMITS = {
  /** Each one can send an sms, which costs money; the number also has its own hourly limit. */
  code: { max: 5, windowMs: 15 * 60_000 },
  /** Guessing a code: five tries per code in the database, this across numbers. */
  verify: { max: 10, windowMs: 15 * 60_000 },
  /** The address field searches as the customer types. */
  address: { max: 60, windowMs: 60_000 },
  suggestions: { max: 30, windowMs: 60_000 },
  /** A booking becomes a request in the firm's list. */
  book: { max: 5, windowMs: 60 * 60_000 },
} as const satisfies Record<string, Limit>;

export type PublicBookingAction = keyof typeof PUBLIC_BOOKING_LIMITS;
