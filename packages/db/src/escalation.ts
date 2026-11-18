/**
 * The receptionist's rules for reaching a person (byggplan step 6.4, spec 8.4 K1–K10), with
 * the database: who is on call, the alerts to staff by push and sms, the follow-up after 30
 * minutes, the voicemail when the agent is down, and the list of messages the mechanic takes.
 * The rules themselves are in `@bojen/core` (`voice/escalation.ts`).
 */
import { createHash } from "node:crypto";
import {
  alertChannels,
  firstName,
  followUp,
  incomingRoute,
  isOnCall,
  onCallOrder,
  planMessage,
  receptionistSettings,
  scrubSensitive,
  toE164,
  type FollowUp,
  type IncomingStep,
  type MessageReason,
  type PushSender,
  type ReceptionistSettings,
  type SmsSender,
  type Transcriber,
} from "@bojen/core";
import { crm } from "@bojen/core/i18n/sv";
import { renderSms } from "@bojen/core/messaging";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { createTask } from "./flows";
import { queueSms, scheduleJob, type MessagingDeps } from "./messaging";
import { appUser, call, customer, message, pushSubscription, task, tenant } from "./schema";

type Db = Pick<Database, "select" | "insert" | "update" | "execute" | "transaction">;
type DbWithDelete = Db & Pick<Database, "delete">;

/** The firm that owns a number the receptionist answers. */
export async function firmByNumber(db: Pick<Database, "select">, number: string) {
  const [row] = await db
    .select({ id: tenant.id, name: tenant.name })
    .from(tenant)
    .where(and(sql`${tenant.settings} -> 'sms' ->> 'from' = ${number}`, isNull(tenant.deletedAt)));
  return row ?? null;
}

/** Worker tasks. */
export const ALERT_TASK = "alert_staff";
export const FOLLOW_UP_TASK = "escalation_follow_up";
export const VOICEMAIL_TASK = "voicemail";

const MINUTE = 60_000;
const t = crm.tasks;

export interface OnCallPerson {
  id: string;
  name: string;
  mobile: string | null;
}

export interface OnCallNow {
  firm: string;
  slug: string | null;
  settings: ReceptionistSettings;
  onCall: boolean;
  /** The mechanics to try, in order (spec 8.4 "nästa mekaniker med jour"). */
  order: OnCallPerson[];
}

/** Who answers for the firm now: its settings, whether it is on-call time, and in what order. */
export async function onCallNow(db: Db, tenantId: string, now: Date): Promise<OnCallNow | null> {
  const [firm] = await db
    .select({ name: tenant.name, slug: tenant.slug, settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!firm) return null;
  const settings = receptionistSettings(firm.settings);
  const staff = await db
    .select({ id: appUser.id, name: appUser.name, mobile: appUser.mobile })
    .from(appUser)
    .where(
      and(
        eq(appUser.tenantId, tenantId),
        isNull(appUser.deletedAt),
        inArray(appUser.role, ["owner", "mechanic"]),
      ),
    )
    .orderBy(sql`${appUser.role} = 'owner' desc`, asc(appUser.createdAt));
  const byId = new Map(staff.map((s) => [s.id, s]));
  const order = onCallOrder(
    settings.onCall,
    staff.map((s) => s.id),
  ).flatMap((id) => byId.get(id) ?? []);
  return {
    firm: firm.name,
    slug: firm.slug,
    settings,
    onCall: isOnCall(settings.onCall, now),
    order,
  };
}

// --- Alerts to staff ----------------------------------------------------------------------

/** Queues the alert for a message: push, and an sms too when it is critical. */
/**
 * The alert job's key: one job per message and set of people, whatever their number.
 * Graphile Worker allows at most 512 characters, so the people are hashed, not listed.
 */
export function alertJobKey(taskId: string, userIds: readonly string[]): string {
  const users = createHash("sha256").update(userIds.join(",")).digest("hex").slice(0, 32);
  return `alert:${taskId}:${users}`;
}

export async function queueAlert(
  db: Pick<Database, "execute">,
  input: {
    tenantId: string;
    taskId: string;
    userIds: readonly string[];
    channels: readonly ("push" | "sms")[];
  },
  at: Date,
): Promise<void> {
  if (input.userIds.length === 0) return;
  const users = input.userIds.join(",");
  await scheduleJob(
    db,
    ALERT_TASK,
    { tenantId: input.tenantId, taskId: input.taskId, users, channels: input.channels.join(",") },
    at,
    alertJobKey(input.taskId, input.userIds),
    5,
  );
}

export interface AlertDeps {
  db: DbWithDelete;
  push: PushSender;
  sms: SmsSender;
  now: () => Date;
  /** For the link in the push and sms, for example `https://bojen.se`. */
  appBase: string;
}

const ARENDEN = "/idag/arenden";
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Sends the alert (the worker's task). Every phone of each person gets the push; a dropped
 * subscription is deleted. A critical alert is also an sms to the person's mobile, day or
 * night: it is for the one on call. Each send is logged in `message`.
 */
export async function sendAlert(
  deps: AlertDeps,
  input: {
    tenantId: string;
    taskId: string;
    userIds: readonly string[];
    channels: readonly string[];
  },
): Promise<{ pushed: number; texted: number }> {
  const [row] = await deps.db
    .select({
      title: task.title,
      note: task.note,
      status: task.status,
      assigneeId: task.assigneeId,
    })
    .from(task)
    .where(and(eq(task.tenantId, input.tenantId), eq(task.id, input.taskId)));
  // Taken or done meanwhile: no one needs waking.
  if (!row || row.status !== "open" || row.assigneeId) return { pushed: 0, texted: 0 };
  const urgent = input.channels.includes("sms");
  const link = `${deps.appBase.replace(/\/+$/, "")}${ARENDEN}`;
  const note = short((row.note ?? "").replace(/\s+/g, " ").trim(), 220);
  let pushed = 0;
  let texted = 0;
  const log = (values: {
    channel: "push" | "sms";
    to: string;
    body: string;
    externalId?: string;
  }) =>
    deps.db.insert(message).values({
      tenantId: input.tenantId,
      channel: values.channel,
      direction: "outbound",
      template: "staff_alert",
      toAddress: values.to,
      body: values.body,
      status: "sent",
      externalId: values.externalId ?? null,
      sentAt: deps.now(),
      createdAt: deps.now(),
    });
  for (const userId of input.userIds) {
    if (input.channels.includes("push")) {
      const targets = await deps.db
        .select()
        .from(pushSubscription)
        .where(
          and(eq(pushSubscription.tenantId, input.tenantId), eq(pushSubscription.userId, userId)),
        );
      for (const target of targets) {
        const sent = await deps.push.send(target, {
          title: row.title,
          body: note,
          url: ARENDEN,
          urgent,
          tag: `task:${input.taskId}`,
        });
        if (sent.gone) {
          await deps.db.delete(pushSubscription).where(eq(pushSubscription.id, target.id));
          continue;
        }
        pushed++;
        await deps.db
          .update(pushSubscription)
          .set({ lastUsedAt: deps.now() })
          .where(eq(pushSubscription.id, target.id));
        await log({ channel: "push", to: `user:${userId}`, body: row.title });
      }
    }
    if (input.channels.includes("sms")) {
      const [person] = await deps.db
        .select({ mobile: appUser.mobile })
        .from(appUser)
        .where(
          and(
            eq(appUser.tenantId, input.tenantId),
            eq(appUser.id, userId),
            isNull(appUser.deletedAt),
          ),
        );
      if (!person?.mobile) continue;
      const body = renderSms("staff_alert", { title: row.title, note, link }).body;
      const sent = await deps.sms.send({ to: person.mobile, body });
      texted++;
      await log({ channel: "sms", to: person.mobile, body, externalId: sent.id });
    }
  }
  return { pushed, texted };
}

// --- A message from the receptionist ------------------------------------------------------

export interface VoiceMessageInput {
  tenantId: string;
  callId: string | null;
  reason: MessageReason;
  /** The model's own words, or the voicemail's transcript. */
  text: string;
  /** The caller's name or number, for the title. */
  who: string;
  customerId: string | null;
  /** The number the caller gets the sms on, if any. */
  callerNumber: string | null;
}

/**
 * Leaves a message for the firm (skapa_meddelande, and the voicemail): a task, an alert to
 * the right mechanics, the sms to the caller the rules ask for, and the follow-up when no
 * one takes an urgent message in time (spec 8.4).
 */
export async function leaveMessage(
  deps: MessagingDeps & { db: Db },
  input: VoiceMessageInput,
): Promise<{ taskId: string }> {
  const now = deps.now();
  const who = await onCallNow(deps.db, input.tenantId, now);
  if (!who) throw new Error("No firm");
  const plan = planMessage({
    reason: input.reason,
    onCall: who.onCall,
    now,
    escalateAfterMinutes: who.settings.escalateAfterMinutes,
  });
  const taskId = await createTask(deps.db, {
    tenantId: input.tenantId,
    type: plan.taskType,
    priority: plan.priority,
    title: t.called(plan.label, input.who),
    note: input.text,
    customerId: input.customerId,
    callId: input.callId,
    dueAt: plan.dueAt,
  });
  if (!taskId) throw new Error("task not created");
  // On call: the first on the list, who is woken if it is critical. Otherwise everyone gets
  // the push, quietly, and whoever is free takes it.
  const first = who.order[0];
  const alerted = who.onCall && first ? [first.id] : who.order.map((s) => s.id);
  await queueAlert(
    deps.db,
    { tenantId: input.tenantId, taskId, userIds: alerted, channels: alertChannels(plan.alert) },
    now,
  );
  if (plan.callerSms && input.callerNumber) {
    const target = {
      tenantId: input.tenantId,
      to: input.callerNumber,
      ...(input.customerId ? { customerId: input.customerId } : {}),
    };
    if (plan.callerSms === "within_30") {
      await queueSms(deps, target, "voice_message_soon", { firm: who.firm });
    } else {
      await queueSms(deps, target, "voice_message_promise", {
        firm: who.firm,
        promise: who.settings.answerPromise,
      });
    }
  }
  if (plan.escalates) {
    await scheduleJob(
      deps.db,
      FOLLOW_UP_TASK,
      { tenantId: input.tenantId, taskId, alerted: alerted.join(",") },
      new Date(now.getTime() + who.settings.escalateAfterMinutes * MINUTE),
      `follow-up:${taskId}`,
    );
  }
  return { taskId };
}

/**
 * No one took the urgent message in time (the worker's task, spec 8.4): the next mechanic on
 * call is told and the wait starts again, or, with no one left, the caller gets the link to
 * the first ordinary time.
 */
export async function runFollowUp(
  deps: MessagingDeps & { db: Db; appBase: string },
  input: { tenantId: string; taskId: string; alerted: readonly string[] },
): Promise<FollowUp> {
  const [row] = await deps.db
    .select({
      status: task.status,
      assigneeId: task.assigneeId,
      customerId: task.customerId,
      caller: call.callerNumber,
    })
    .from(task)
    .leftJoin(call, and(eq(call.tenantId, task.tenantId), eq(call.id, task.callId)))
    .where(and(eq(task.tenantId, input.tenantId), eq(task.id, input.taskId)));
  const now = deps.now();
  const who = await onCallNow(deps.db, input.tenantId, now);
  if (!row || !who) return { do: "nothing" };
  const next = followUp({
    handled: row.status !== "open" || row.assigneeId !== null,
    alerted: input.alerted,
    order: who.order.map((s) => s.id),
    onCall: who.onCall,
  });
  if (next.do === "alert_next") {
    const alerted = [...input.alerted, next.userId];
    await queueAlert(
      deps.db,
      {
        tenantId: input.tenantId,
        taskId: input.taskId,
        userIds: [next.userId],
        channels: ["push", "sms"],
      },
      now,
    );
    await scheduleJob(
      deps.db,
      FOLLOW_UP_TASK,
      { tenantId: input.tenantId, taskId: input.taskId, alerted: alerted.join(",") },
      new Date(now.getTime() + who.settings.escalateAfterMinutes * MINUTE),
      `follow-up:${input.taskId}`,
    );
  }
  if (next.do === "offer_first_time" && row.caller) {
    const base = deps.appBase.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    await queueSms(
      deps,
      {
        tenantId: input.tenantId,
        to: row.caller,
        ...(row.customerId ? { customerId: row.customerId } : {}),
      },
      "voice_first_time",
      { firm: who.firm, link: who.slug ? `${base}/boka/${who.slug}` : base },
    );
  }
  return next;
}

// --- When the agent is down (K10) --------------------------------------------------------

/** Where a call to the firm's number goes: the steps, and the mechanic's mobile. */
export async function incomingCall(
  db: Db,
  input: { to: string; agentUp: boolean; now: Date },
): Promise<{ tenantId: string; steps: IncomingStep[]; mechanic: string | null } | null> {
  const firm = await firmByNumber(db, toE164(input.to) ?? input.to);
  if (!firm) return null;
  const who = await onCallNow(db, firm.id, input.now);
  if (!who) return null;
  // The firm's choice, else the one on call now, else the owner (first in the order).
  const chosen = who.settings.fallbackUserId
    ? who.order.find((s) => s.id === who.settings.fallbackUserId)
    : undefined;
  const person = chosen?.mobile ? chosen : who.order.find((s) => s.mobile);
  const mechanic = person?.mobile ?? null;
  return {
    tenantId: firm.id,
    steps: incomingRoute({ agentUp: input.agentUp, mechanic }),
    mechanic,
  };
}

/** A voicemail is in (46elks' record callback): a call row, and the transcription queued. */
export async function saveVoicemail(
  db: Db,
  input: {
    to: string;
    from: string | null;
    callId: string;
    wav: string;
    seconds: number;
    now: Date;
  },
): Promise<{ callId: string } | null> {
  const firm = await firmByNumber(db, toE164(input.to) ?? input.to);
  if (!firm) return null;
  const from = input.from ? toE164(input.from) : null;
  const [known] = from
    ? await db
        .select({ id: customer.id })
        .from(customer)
        .where(
          and(eq(customer.tenantId, firm.id), eq(customer.phone, from), isNull(customer.deletedAt)),
        )
        .limit(2)
    : [];
  const [row] = await db
    .insert(call)
    .values({
      tenantId: firm.id,
      callerNumber: from,
      customerId: known?.id ?? null,
      startedAt: new Date(input.now.getTime() - input.seconds * 1000),
      endedAt: input.now,
      // A voicemail is left to be heard; only its text is kept, not the audio.
      recordingAllowed: false,
      outcome: "message",
      externalId: input.callId.slice(0, 200),
    })
    .returning({ id: call.id });
  if (!row) throw new Error("call not created");
  await scheduleJob(
    db,
    VOICEMAIL_TASK,
    { tenantId: firm.id, callId: row.id, wav: input.wav },
    input.now,
    `voicemail:${row.id}`,
    5,
  );
  return { callId: row.id };
}

/** The worker's half: fetch, transcribe, scrub, and leave it as a message. */
export async function runVoicemail(
  deps: MessagingDeps & {
    db: Db;
    recordings: { fetch(wav: string): Promise<{ bytes: Uint8Array; contentType: string }> };
    /** Null until speech to text is set up (Azure, step 6.2b): the message says so. */
    transcriber: Transcriber | null;
  },
  input: { tenantId: string; callId: string; wav: string },
): Promise<{ taskId: string } | null> {
  const [c] = await deps.db
    .select()
    .from(call)
    .where(and(eq(call.tenantId, input.tenantId), eq(call.id, input.callId)));
  if (!c) return null;
  const [done] = await deps.db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.tenantId, input.tenantId), eq(task.callId, c.id)));
  if (done) return { taskId: done.id };
  let text: string = t.untranscribed;
  if (deps.transcriber) {
    const audio = await deps.recordings.fetch(input.wav);
    const heard = scrubSensitive((await deps.transcriber.transcribe(audio)).trim());
    text = heard || t.emptyVoicemail;
  }
  await deps.db.update(call).set({ transcript: text, summary: text }).where(eq(call.id, c.id));
  const [person] = c.customerId
    ? await deps.db
        .select({ name: customer.name })
        .from(customer)
        .where(eq(customer.id, c.customerId))
    : [];
  const created = await leaveMessage(deps, {
    tenantId: input.tenantId,
    callId: c.id,
    reason: "ring_upp",
    text,
    who: person?.name ?? c.callerNumber ?? t.unknownCaller,
    customerId: c.customerId,
    callerNumber: null,
  });
  await deps.db
    .update(task)
    .set({ title: t.voicemail(person?.name ?? c.callerNumber ?? t.unknownCaller) })
    .where(eq(task.id, created.taskId));
  return created;
}

// --- The mechanic's list ------------------------------------------------------------------

export interface OpenTask {
  id: string;
  title: string;
  note: string | null;
  priority: "normal" | "high";
  dueAt: Date | null;
  createdAt: Date;
  /** The number to call back: the customer's, else the call's. */
  phone: string | null;
  takenBy: string | null;
  callSummary: string | null;
}

/** Open messages, urgent first, then the oldest. */
export async function openTasks(db: Db, tenantId: string): Promise<OpenTask[]> {
  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      note: task.note,
      priority: task.priority,
      dueAt: task.dueAt,
      createdAt: task.createdAt,
      customerPhone: customer.phone,
      callerNumber: call.callerNumber,
      takenBy: appUser.name,
      callSummary: call.summary,
    })
    .from(task)
    .leftJoin(customer, and(eq(customer.tenantId, task.tenantId), eq(customer.id, task.customerId)))
    .leftJoin(call, and(eq(call.tenantId, task.tenantId), eq(call.id, task.callId)))
    .leftJoin(appUser, and(eq(appUser.tenantId, task.tenantId), eq(appUser.id, task.assigneeId)))
    .where(and(eq(task.tenantId, tenantId), eq(task.status, "open"), isNull(task.deletedAt)))
    .orderBy(desc(sql`${task.priority} = 'high'`), asc(task.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    priority: r.priority,
    dueAt: r.dueAt,
    createdAt: r.createdAt,
    phone: r.customerPhone ?? r.callerNumber,
    takenBy: r.takenBy ? firstName(r.takenBy) : null,
    callSummary: r.callSummary,
  }));
}

/**
 * "Jag tar det" or "Klart". Taking it stops the follow-up (spec 8.4 "Mekaniker svarar inom 30
 * min?"); false when the task is gone, done, or another firm's.
 */
export async function decideTask(
  db: Db,
  actor: { tenantId: string; userId: string },
  taskId: string,
  decision: "take" | "done",
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(task)
    .set(
      decision === "take"
        ? { assigneeId: sql`coalesce(${task.assigneeId}, ${actor.userId}::uuid)` }
        : {
            status: "done",
            completedAt: now,
            assigneeId: sql`coalesce(${task.assigneeId}, ${actor.userId}::uuid)`,
          },
    )
    .where(and(eq(task.tenantId, actor.tenantId), eq(task.id, taskId), eq(task.status, "open")))
    .returning({ id: task.id });
  return rows.length > 0;
}

// --- Push subscriptions --------------------------------------------------------------------

/** Saves the browser's subscription for the signed-in staff member; the same one again moves. */
export async function savePushSubscription(
  db: Db,
  actor: { tenantId: string; userId: string },
  input: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .insert(pushSubscription)
    .values({ tenantId: actor.tenantId, userId: actor.userId, ...input })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        p256dh: input.p256dh,
        auth: input.auth,
      },
    });
}

export async function deletePushSubscription(
  db: DbWithDelete,
  actor: { tenantId: string; userId: string },
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscription)
    .where(
      and(
        eq(pushSubscription.tenantId, actor.tenantId),
        eq(pushSubscription.userId, actor.userId),
        eq(pushSubscription.endpoint, endpoint),
      ),
    );
}
