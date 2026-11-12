/**
 * Replies by sms (byggplan step 3.2). A reply is logged, linked to the newest open question
 * to the same number from the same firm, and interpreted: the rules first, then the model
 * for free text. STOPP puts the number on the firm's list and sends one receipt. A reply
 * that cannot be read with 90 % certainty becomes a task, so a person reads it.
 *
 * What a JA or NEJ then does to the visit belongs to the flows (steps 3.3 and 4.2).
 */
import { sv, toE164, type ReplyClassifier } from "@bojen/core";
import {
  ALLOWED_INTENTS,
  QUESTION_TEMPLATES,
  checkModelAnswer,
  needsPerson,
  routeInbound,
  ruleIntent,
  type Interpretation,
  type QuestionKind,
} from "@bojen/core/messaging";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { optOutNumber, queueSms, type MessagingDeps } from "./messaging";
import { customer, domainEvent, message, task, tenant, visit } from "./schema";

export interface InboundDeps extends MessagingDeps {
  classifier: ReplyClassifier;
}

export interface InboundSms {
  /** 46elks' id of the message; a retried webhook with the same id is not handled twice. */
  externalId: string;
  from: string;
  /** The firm's number that the customer wrote to. */
  to: string;
  body: string;
}

export type ReceiveResult =
  | { status: "unknown_number" }
  | { status: "duplicate"; messageId: string }
  | {
      status: "received";
      messageId: string;
      kind: QuestionKind;
      questionId: string | null;
      interpretation: Interpretation;
      taskId: string | null;
    };

/** How far back to look for a question; no question is open longer than this. */
const LOOK_BACK_MS = 30 * 24 * 3_600_000;

/** The firm whose sms number (`tenant.settings.sms.from`) the customer wrote to. */
async function firmByNumber(db: Database, number: string) {
  const [row] = await db
    .select({ id: tenant.id, name: tenant.name })
    .from(tenant)
    .where(and(sql`${tenant.settings} -> 'sms' ->> 'from' = ${number}`, isNull(tenant.deletedAt)));
  return row ?? null;
}

/** The questions sent to the number lately, with whether a reply is already linked. */
async function sentQuestions(db: Database, tenantId: string, phone: string, now: Date) {
  return db
    .select({
      id: message.id,
      template: message.template,
      sentAt: message.sentAt,
      customerId: message.customerId,
      boatId: message.boatId,
      visitId: message.visitId,
      visitStart: sql<Date | null>`lower(${visit.timeWindow})`.mapWith((v: string | null) =>
        v === null ? null : new Date(v),
      ),
      answered: sql<boolean>`exists (select 1 from message as reply where reply.tenant_id = ${message.tenantId} and reply.reply_to_id = ${message.id})`,
    })
    .from(message)
    .leftJoin(visit, and(eq(visit.tenantId, message.tenantId), eq(visit.id, message.visitId)))
    .where(
      and(
        eq(message.tenantId, tenantId),
        eq(message.channel, "sms"),
        eq(message.direction, "outbound"),
        eq(message.toAddress, phone),
        inArray(message.status, ["sent", "delivered"]),
        inArray(message.template, QUESTION_TEMPLATES),
        gte(message.createdAt, new Date(now.getTime() - LOOK_BACK_MS)),
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(20);
}

/** Rules first; free text to the model, whose answer is checked. A failing model is unclear. */
async function interpret(
  classifier: ReplyClassifier,
  body: string,
  kind: QuestionKind,
): Promise<Interpretation> {
  const byRule = ruleIntent(body, kind);
  if (byRule) return byRule;
  try {
    const answer = await classifier.classify({
      reply: body,
      question: kind,
      allowed: ALLOWED_INTENTS[kind],
    });
    return checkModelAnswer(answer, kind);
  } catch {
    return { intent: "unclear", confidence: 0, source: "none" };
  }
}

export async function receiveSms(deps: InboundDeps, sms: InboundSms): Promise<ReceiveResult> {
  const now = deps.now();
  const to = toE164(sms.to) ?? sms.to;
  const from = toE164(sms.from) ?? sms.from;
  const firm = await firmByNumber(deps.db as Database, to);
  if (!firm) return { status: "unknown_number" };

  const [seen] = await deps.db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.tenantId, firm.id),
        eq(message.direction, "inbound"),
        eq(message.externalId, sms.externalId),
      ),
    );
  if (seen) return { status: "duplicate", messageId: seen.id };

  const questions = await sentQuestions(deps.db as Database, firm.id, from, now);
  const route = routeInbound(
    questions.flatMap((q) =>
      q.template && q.sentAt
        ? [
            {
              id: q.id,
              template: q.template,
              sentAt: q.sentAt,
              visitStart: q.visitStart,
              answered: q.answered,
            },
          ]
        : [],
    ),
    now,
  );
  const question = questions.find((q) => q.id === route.question?.id) ?? null;
  const [known] = await deps.db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(
      and(eq(customer.tenantId, firm.id), eq(customer.phone, from), isNull(customer.deletedAt)),
    );

  // The model is asked outside the transaction: it is a call over the network.
  const interpretation = await interpret(deps.classifier, sms.body, route.kind);

  const result = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(message)
      .values({
        tenantId: firm.id,
        channel: "sms",
        direction: "inbound",
        fromAddress: from,
        toAddress: to,
        body: sms.body,
        status: "received",
        externalId: sms.externalId,
        intent: interpretation.intent,
        intentConfidence: interpretation.confidence,
        rating: interpretation.rating ?? null,
        replyToId: question?.id ?? null,
        customerId: question?.customerId ?? known?.id ?? null,
        boatId: question?.boatId ?? null,
        visitId: question?.visitId ?? null,
        createdAt: now,
      })
      .returning({ id: message.id });
    if (!row) throw new Error("message insert returned nothing");

    // The flows react to the reply (F9 now, the 24-hour check in phase 4).
    await tx.insert(domainEvent).values({
      tenantId: firm.id,
      aggregateType: "message",
      aggregateId: row.id,
      type: "message.received",
      payload: {
        intent: interpretation.intent,
        confident: !needsPerson(interpretation),
        ...(interpretation.rating ? { rating: interpretation.rating } : {}),
        ...(question?.template ? { questionTemplate: question.template } : {}),
        ...(question?.visitId ? { visitId: question.visitId } : {}),
      },
      actorType: "customer",
      actorId: question?.customerId ?? known?.id ?? null,
      occurredAt: now,
    });

    let taskId: string | null = null;
    if (interpretation.intent !== "stop" && needsPerson(interpretation)) {
      const [created] = await tx
        .insert(task)
        .values({
          tenantId: firm.id,
          type: "unclear_reply",
          title: sv.inbox.unclearReply(known?.name ?? from),
          note: sms.body,
          customerId: question?.customerId ?? known?.id ?? null,
          visitId: question?.visitId ?? null,
          messageId: row.id,
          dueAt: new Date(now.getTime() + 24 * 3_600_000),
        })
        .returning({ id: task.id });
      taskId = created?.id ?? null;
    }
    if (interpretation.intent === "stop") {
      await optOutNumber(tx, deps.optOutKey, {
        tenantId: firm.id,
        phone: from,
        source: "sms_stop",
      });
    }
    return { messageId: row.id, taskId };
  });

  if (interpretation.intent === "stop") {
    // The one receipt: the last sms the number gets from the firm.
    await queueSms(
      deps,
      { tenantId: firm.id, to: from, ...(known ? { customerId: known.id } : {}) },
      "stop_receipt",
      { firm: firm.name },
    );
  }

  return {
    status: "received",
    messageId: result.messageId,
    kind: route.kind,
    questionId: question?.id ?? null,
    interpretation,
    taskId: result.taskId,
  };
}
