import type { SmsSender } from "@bojen/core";

export interface FakeSms extends SmsSender {
  /** Every message, in order. Tests read codes from here instead of a phone. */
  readonly sent: { id: string; to: string; body: string }[];
  /** The newest message to a number. */
  lastTo(to: string): string | undefined;
}

/** Sends nothing; keeps the messages in memory. Used in tests and local development. */
export function createFakeSms(): FakeSms {
  const sent: FakeSms["sent"] = [];
  return {
    sent,
    send(message) {
      const id = `fake-${String(sent.length + 1)}`;
      sent.push({ id, ...message });
      return Promise.resolve({ id });
    },
    lastTo(to) {
      return sent.filter((m) => m.to === to).at(-1)?.body;
    },
  };
}
