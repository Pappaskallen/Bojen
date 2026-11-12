import { loadDomainEvent, visitContext } from "@bojen/db";
import { scheduleCheck } from "./availabilityCheck";
import { sendConfirmation } from "./confirmation";
import type { FlowDeps } from "./deps";
import { scheduleEta } from "./morningEta";
import { type ReportContent, sendServiceReport } from "./serviceReport";
import { handleSurveyAnswer, scheduleSurvey } from "./survey";

export const DOMAIN_EVENT_TASK = "domain_event";

/** What a domain event led to, for the log and the tests. */
export type EventOutcome =
  "confirmation" | "eta_moved" | "survey_scheduled" | "report" | "survey_answer" | "ignored";

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
