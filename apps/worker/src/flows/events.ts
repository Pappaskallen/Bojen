import { jobAfterInvoice, loadDomainEvent, visitContext } from "@bojen/db";
import { scheduleCheck } from "./availabilityCheck";
import { handleCheckEvent } from "./availabilityFollowup";
import { sendConfirmation } from "./confirmation";
import type { FlowDeps } from "./deps";
import { scheduleEta } from "./morningEta";
import { handleOfferAnswer, startWaitlist } from "./waitlistOffer";
import { type ReportContent, sendServiceReport } from "./serviceReport";
import { handleSurveyAnswer, scheduleSurvey } from "./survey";

export const DOMAIN_EVENT_TASK = "domain_event";

/** What a domain event led to, for the log and the tests. */
export type EventOutcome =
  | "confirmation"
  | "eta_moved"
  | "survey_scheduled"
  | "report"
  | "survey_answer"
  | "check_answer"
  | "waitlist_started"
  | "waitlist_answer"
  | "invoiced"
  | "ignored";

const CHECK_QUESTION = /^f3_(check_|reminder$)/;

const SCHEDULED = new Set(["booked", "confirmed", "unconfirmed"]);

/** Puts the availability check (F3) in for a visit that has just become booked. */
async function planCheck(deps: FlowDeps, tenantId: string, visitId: string) {
  const visit = await visitContext(deps.db, tenantId, visitId);
  if (visit) await scheduleCheck(deps, visit);
}

/**
 * Every domain event comes here (a database trigger queues it, migration 0017) and goes to
 * the flow it starts. An event no flow cares about is ignored.
 */
export async function handleDomainEvent(deps: FlowDeps, eventId: string): Promise<EventOutcome> {
  const event = await loadDomainEvent(deps.db, eventId);
  if (!event) return "ignored";
  const { tenantId, payload } = event;
  const visitId = event.aggregateType === "visit" ? event.aggregateId : undefined;

  switch (event.type) {
    case "visit.created":
      if (visitId && payload.status === "booked") {
        await sendConfirmation(deps, tenantId, visitId);
        await planCheck(deps, tenantId, visitId);
        return "confirmation";
      }
      return "ignored";
    case "visit.approve":
    case "visit.parts_arrived":
      if (visitId && payload.to === "booked") {
        await sendConfirmation(deps, tenantId, visitId);
        await planCheck(deps, tenantId, visitId);
        return "confirmation";
      }
      return "ignored";
    case "visit.reschedule": {
      if (!visitId) return "ignored";
      const visit = await visitContext(deps.db, tenantId, visitId);
      if (!visit || !SCHEDULED.has(visit.status)) return "ignored";
      // A new time needs a new availability check (F3, step 4.1).
      await scheduleCheck(deps, visit);
      // The customer moved it through the link, which used the link up: a new F1 with a new
      // link (step 3.4). F1 also moves F5.
      if (event.actorType === "customer" && visit.status === "booked") {
        const sent = await sendConfirmation(deps, tenantId, visitId, { afterCustomerChange: true });
        if (sent === "sent") return "confirmation";
      }
      return (await scheduleEta(deps, visit)) ? "eta_moved" : "ignored";
    }
    case "visit.cancel":
      // A freed time goes to the waitlist (F4, step 4.3).
      if (!visitId) return "ignored";
      return (await startWaitlist(deps, tenantId, visitId)) === "started"
        ? "waitlist_started"
        : "ignored";
    case "invoice.created":
      // From Fortnox in step 8; the card moves to invoiced (step 5.4).
      if (typeof payload.jobId !== "string") return "ignored";
      return (await jobAfterInvoice(deps.db, tenantId, payload.jobId, event.occurredAt))
        ? "invoiced"
        : "ignored";
    case "visit.complete":
      if (!visitId) return "ignored";
      await scheduleSurvey(deps, tenantId, visitId, event.occurredAt);
      return "survey_scheduled";
    case "report.approved": {
      const reportVisit = typeof payload.visitId === "string" ? payload.visitId : visitId;
      if (!reportVisit) return "ignored";
      await sendServiceReport(deps, tenantId, reportVisit, payload as ReportContent);
      return "report";
    }
    case "message.received":
      // An answer to the availability check or its reminder (F3, step 4.2).
      if (
        typeof payload.questionTemplate === "string" &&
        CHECK_QUESTION.test(payload.questionTemplate) &&
        payload.confident === true &&
        typeof payload.visitId === "string" &&
        (payload.intent === "yes" || payload.intent === "no" || payload.intent === "change")
      ) {
        const outcome = await handleCheckEvent(
          deps,
          tenantId,
          payload.visitId,
          payload.intent,
          event.id,
        );
        return outcome === "ignored" ? "ignored" : "check_answer";
      }
      // An answer to an offer of a freed time (F4, step 4.3).
      if (
        payload.questionTemplate === "f4_offer" &&
        payload.confident === true &&
        typeof payload.visitId === "string" &&
        event.actorId &&
        (payload.intent === "yes" || payload.intent === "no")
      ) {
        const outcome = await handleOfferAnswer(
          deps,
          tenantId,
          payload.visitId,
          event.actorId,
          payload.intent,
        );
        return outcome === "ignored" ? "ignored" : "waitlist_answer";
      }
      if (
        payload.questionTemplate === "f9_survey" &&
        payload.intent === "rating" &&
        payload.confident === true &&
        typeof payload.rating === "number" &&
        typeof payload.visitId === "string"
      ) {
        await handleSurveyAnswer(deps, tenantId, payload.visitId, payload.rating);
        return "survey_answer";
      }
      return "ignored";
    default:
      return "ignored";
  }
}
