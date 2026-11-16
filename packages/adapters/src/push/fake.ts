import type { PushPayload, PushSender, PushTarget } from "@bojen/core";

export interface FakePush extends PushSender {
  readonly sent: { endpoint: string; payload: PushPayload }[];
  /** Endpoints the fake answers as gone, like a browser that dropped the subscription. */
  readonly gone: Set<string>;
}

/** Push for tests and development: nothing leaves the machine. */
export function createFakePush(): FakePush {
  const sent: FakePush["sent"] = [];
  const gone = new Set<string>();
  return {
    sent,
    gone,
    send(target: PushTarget, payload: PushPayload) {
      if (gone.has(target.endpoint)) return Promise.resolve({ gone: true });
      sent.push({ endpoint: target.endpoint, payload });
      return Promise.resolve({ gone: false });
    },
  };
}
