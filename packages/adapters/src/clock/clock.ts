/**
 * Every external dependency is reached through an adapter with a fake
 * implementation for tests. The clock is the first one.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface FakeClock extends Clock {
  set(time: Date): void;
  advance(ms: number): void;
}

export function createFakeClock(start: Date): FakeClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (time) => {
      current = time.getTime();
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
