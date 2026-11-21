import type { EmailSender, OutgoingEmail } from "@bojen/core";

export interface FakeEmail extends EmailSender {
  readonly sent: (OutgoingEmail & { id: string })[];
}

/** Sends nothing; keeps the e-mails in memory. Used in tests and local development. */
export function createFakeEmail(): FakeEmail {
  const sent: FakeEmail["sent"] = [];
  return {
    sent,
    send(message) {
      const id = `fake-email-${String(sent.length + 1)}`;
      sent.push({ id, ...message });
      return Promise.resolve({ id });
    },
  };
}
