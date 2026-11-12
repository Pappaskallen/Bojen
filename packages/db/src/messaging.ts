/**
 * The one way out for messages (byggplan step 3.1). Everything is logged in `message`;
 * the rules for quiet hours and STOPP come from `@bojen/core/messaging`.
 *
 * - `queueSms` renders a template, applies the rules and leaves the sms to the worker
 *   (Graphile Worker task `send_message`), at 08:00 if it falls in the quiet hours.
 * - `sendCodeSms` sends a one-time code at once. The code is never stored or logged.
 * - `deliverQueuedMessage` is the worker's half: STOPP is checked again just before sending.
 * - `recordDelivery` takes 46elks' delivery reports.
 */
import type { EmailSender, SmsSender } from "@bojen/core";
import {
  SMS_TEMPLATES,
  ignoresOptOut,
  optOutHash,
  planSms,
  quietUntilFor,
  renderEmail,
  renderSms,
  type EmailTemplateKey,
  type EmailVars,
  type SmsTemplateKey,
  type SmsVars,
} from "@bojen/core/messaging";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "./client";
import { message, smsOptOut, tenant } from "./schema";

/** The Graphile Worker task that sends one queued message. */
export const SEND_MESSAGE_TASK = "send_message";

export interface MessagingDeps {
  db: Pick<Database, "select" | "insert" | "update" | "execute" | "transaction">;
  now: () => Date;
  /** The server secret that opted-out numbers are hashed with (`SMS_OPT_OUT_KEY`). */
  optOutKey: string;
}

export interface SmsTarget {
  tenantId: string;
  /** In E.164; null when the customer has no mobile number. */
  to: string | null;
  customerId?: string;
  boatId?: string;
  visitId?: string;
}

/** A connection or a transaction: whatever can run the queries below. */
type Db = Pick<Database, "select" | "insert" | "update">;

export async function isOptedOut(
  db: Db,
  optOutKey: string,
  tenantId: string,
  phone: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: smsOptOut.id })
    .from(smsOptOut)
    .where(
      and(
        eq(smsOptOut.tenantId, tenantId),
        eq(smsOptOut.phoneHash, optOutHash(optOutKey, tenantId, phone)),
      ),
    );
  return Boolean(row);
}

/** Puts a number on the firm's STOPP list. Doing it twice changes nothing. */
export async function optOutNumber(
  db: Db,
  optOutKey: string,
  input: { tenantId: string; phone: string; source: string },
): Promise<void> {
  await db
    .insert(smsOptOut)
    .values({
      tenantId: input.tenantId,
      phoneHash: optOutHash(optOutKey, input.tenantId, input.phone),
      source: input.source,
    })
    .onConflictDoNothing();
}

export type QueueResult =
  | { status: "queued"; messageId: string; sendAfter: Date }
  | { status: "blocked"; messageId: string; reason: "opted_out" | "no_address" };

/**
 * Queues the worker task for a message. The job key is the message, so queueing it again
 * (or from the running task) moves the one job instead of adding a second.
 */
async function addSendJob(db: Pick<Database, "execute">, messageId: string, at: Date) {
  await scheduleJob(db, SEND_MESSAGE_TASK, { messageId }, at, `message:${messageId}`, 5);
}

/**
 * Queues a Graphile Worker task at `at`. With a key, queueing again moves the one job (for
 * example a rescheduled visit's 07:00 sms) instead of adding a second.
 */
export async function scheduleJob(
  db: Pick<Database, "execute">,
  taskName: string,
  payload: Record<string, string>,
  at: Date,
  key?: string,
  maxAttempts = 10,
): Promise<void> {
  await db.execute(sql`
    select graphile_worker.add_job(
      ${taskName},
      ${JSON.stringify(payload)}::json,
      run_at => ${at.toISOString()}::timestamptz,
      max_attempts => ${maxAttempts}::int,
      job_key => ${key ?? null}::text
    )`);
}

type QueuedKey = Exclude<SmsTemplateKey, "staff_sign_in_code" | "booking_code">;

/**
 * Logs an sms and queues it for the worker, or logs it as blocked. Codes do not come
 * through here (see `sendCodeSms`), so the body is safe to keep.
 */
export async function queueSms<K extends QueuedKey>(
  deps: MessagingDeps,
  target: SmsTarget,
  key: K,
  vars: SmsVars<K>,
  options: { wanted?: Date } = {},
): Promise<QueueResult> {
  const rendered = renderSms(key, vars);
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const optedOut = target.to
      ? await isOptedOut(tx, deps.optOutKey, target.tenantId, target.to)
      : false;
    const plan = planSms({
      category: rendered.category,
      to: target.to,
      optedOut,
      now,
      quietUntil: quietUntilFor(key),
      ...(options.wanted ? { wanted: options.wanted } : {}),
    });
    const [row] = await tx
      .insert(message)
      .values({
        tenantId: target.tenantId,
        channel: "sms",
        direction: "outbound",
        template: key,
        customerId: target.customerId,
        boatId: target.boatId,
        visitId: target.visitId,
        toAddress: target.to,
        body: rendered.body,
        status: plan.action === "send" ? "queued" : "blocked",
        sendAfter: plan.action === "send" ? plan.at : null,
        error: plan.action === "block" ? plan.reason : null,
        createdAt: now,
      })
      .returning({ id: message.id });
    if (!row) throw new Error("message insert returned nothing");
    if (plan.action === "block")
      return { status: "blocked", messageId: row.id, reason: plan.reason };
    await addSendJob(tx, row.id, plan.at);
    return { status: "queued", messageId: row.id, sendAfter: plan.at };
  });
}

/**
 * Logs an e-mail and queues it for the worker. E-mail has no quiet hours and no STOPP list;
 * the flow decides whether to send one at all.
 */
export async function queueEmail<K extends EmailTemplateKey>(
  deps: Pick<MessagingDeps, "db" | "now">,
  target: Omit<SmsTarget, "to"> & { to: string },
  key: K,
  vars: EmailVars<K>,
): Promise<{ messageId: string }> {
  const rendered = renderEmail(key, vars);
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(message)
      .values({
        tenantId: target.tenantId,
        channel: "email",
        direction: "outbound",
        template: key,
        customerId: target.customerId,
        boatId: target.boatId,
        visitId: target.visitId,
        toAddress: target.to,
        subject: rendered.subject,
        body: rendered.text,
        bodyHtml: rendered.html,
        status: "queued",
        sendAfter: now,
        createdAt: now,
      })
      .returning({ id: message.id });
    if (!row) throw new Error("message insert returned nothing");
    await addSendJob(tx, row.id, now);
    return { messageId: row.id };
  });
}

/** The firm's sender (`tenant.settings.sms.from`), or the adapter's default. */
async function senderOf(db: Db, tenantId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const sms = row?.settings.sms as { from?: unknown } | undefined;
  return typeof sms?.from === "string" ? sms.from : undefined;
}

/**
 * Sends a one-time code at once, day or night and also after STOPP: the person just asked
 * for it. The log row has the template and number but no body, so the code is nowhere.
 */
export async function sendCodeSms<K extends "staff_sign_in_code" | "booking_code">(
  deps: { db: Db; now: () => Date; sms: SmsSender },
  target: SmsTarget & { to: string },
  key: K,
  vars: SmsVars<K>,
): Promise<void> {
  const rendered = renderSms(key, vars);
  const now = deps.now();
  const [row] = await deps.db
    .insert(message)
    .values({
      tenantId: target.tenantId,
      channel: "sms",
      direction: "outbound",
      template: key,
      customerId: target.customerId,
      toAddress: target.to,
      body: null,
      status: "queued",
      sendAfter: now,
      createdAt: now,
    })
    .returning({ id: message.id });
  if (!row) throw new Error("message insert returned nothing");
  try {
    const from = await senderOf(deps.db, target.tenantId);
    const sent = await deps.sms.send({
      to: target.to,
      body: rendered.body,
      ...(from ? { from } : {}),
    });
    await deps.db
      .update(message)
      .set({ status: "sent", externalId: sent.id, sentAt: deps.now() })
      .where(eq(message.id, row.id));
  } catch (error) {
    await deps.db
      .update(message)
      .set({ status: "failed", error: error instanceof Error ? error.name : "error" })
      .where(eq(message.id, row.id));
    throw error;
  }
}

export type DeliverResult = "sent" | "blocked" | "not_queued" | "too_early";

/**
 * Sends one queued sms (the worker's task). The row is locked while sending, so two
 * workers never send the same message; a failed send rolls back and is retried. Run too
 * early, it puts the job back for the message's time.
 */
export async function deliverQueuedMessage(
  deps: MessagingDeps & { sms: SmsSender; email?: EmailSender },
  messageId: string,
): Promise<DeliverResult> {
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(message)
      .where(and(eq(message.id, messageId), eq(message.status, "queued")))
      .for("update", { skipLocked: true });
    if (!row || !row.toAddress || row.body === null) return "not_queued";
    const now = deps.now();
    if (row.sendAfter && row.sendAfter > now) {
      await addSendJob(tx, row.id, row.sendAfter);
      return "too_early";
    }
    if (row.channel === "email") {
      if (!deps.email) throw new Error("No e-mail sender configured");
      const sent = await deps.email.send({
        to: row.toAddress,
        subject: row.subject ?? "",
        text: row.body,
        html: row.bodyHtml ?? "",
      });
      await tx
        .update(message)
        .set({ status: "sent", externalId: sent.id, sentAt: now, error: null })
        .where(eq(message.id, row.id));
      return "sent";
    }
    if (row.channel !== "sms") return "not_queued";
    const template = row.template as SmsTemplateKey | null;
    const always = template !== null && ignoresOptOut(SMS_TEMPLATES[template].category);
    if (!always && (await isOptedOut(tx, deps.optOutKey, row.tenantId, row.toAddress))) {
      await tx
        .update(message)
        .set({ status: "blocked", error: "opted_out" })
        .where(eq(message.id, row.id));
      return "blocked";
    }
    const from = await senderOf(tx, row.tenantId);
    const sent = await deps.sms.send({
      to: row.toAddress,
      body: row.body,
      ...(from ? { from } : {}),
    });
    await tx
      .update(message)
      .set({ status: "sent", externalId: sent.id, sentAt: now, error: null })
      .where(eq(message.id, row.id));
    return "sent";
  });
}

/**
 * A delivery report from 46elks. A report for an unknown id changes nothing, and a late
 * "sent" never takes back "delivered".
 */
export async function recordDelivery(
  db: Db,
  report: { externalId: string; status: "delivered" | "failed" | "sent"; deliveredAt: Date | null },
): Promise<boolean> {
  if (report.status === "sent") return false;
  const updated = await db
    .update(message)
    .set(
      report.status === "delivered"
        ? { status: "delivered", deliveredAt: report.deliveredAt ?? new Date() }
        : { status: "failed", error: "not_delivered" },
    )
    .where(
      and(
        eq(message.externalId, report.externalId),
        eq(message.direction, "outbound"),
        ne(message.status, "delivered"),
      ),
    )
    .returning({ id: message.id });
  return updated.length > 0;
}
