import type { SmsSender } from "@bojen/core";
import { deliverQueuedMessage, type Database } from "@bojen/db";
import type { Task } from "graphile-worker";

export interface SendMessageDeps {
  db: Database;
  sms: SmsSender;
  now: () => Date;
  optOutKey: string;
}

function messageIdOf(payload: unknown): string {
  const id = (payload as { messageId?: unknown } | null)?.messageId;
  if (typeof id !== "string") throw new Error("send_message needs { messageId }");
  return id;
}

/**
 * Graphile Worker task `send_message` (byggplan step 3.1): sends one queued sms. STOPP is
 * checked again here, since the customer may have replied after the sms was queued.
 * A failed send throws, and Graphile retries it (at most 5 times, with growing pauses).
 */
export function sendMessageTask(deps: SendMessageDeps): Task {
  return async (payload, helpers) => {
    const messageId = messageIdOf(payload);
    const result = await deliverQueuedMessage(deps, messageId);
    helpers.logger.info(`message ${messageId}: ${result}`);
  };
}
