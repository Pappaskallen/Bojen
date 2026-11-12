import { sv, surveyAllowed, surveyFollowUp, surveySendTime } from "@bojen/core";
import {
  answerSurvey,
  createTask,
  lastSurveyFor,
  queueSms,
  scheduleJob,
  startSurvey,
  visitContext,
} from "@bojen/db";
import { type FlowDeps, visitVars } from "./deps";

export const SURVEY_TASK = "visit_survey";

/** Puts F9 in for 18 hours after the visit was done, within 10:00–19:00. */
export async function scheduleSurvey(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  doneAt: Date,
): Promise<Date> {
  const at = surveySendTime(doneAt);
  await scheduleJob(deps.db, SURVEY_TASK, { tenantId, visitId }, at, `survey:${visitId}`);
  return at;
}

/**
 * F9, the satisfaction question. Not to a customer who got one in the last 90 days.
 * (The spec also leaves out warranty jobs, but nothing marks them yet.)
 */
export async function sendSurvey(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
): Promise<"sent" | "skipped"> {
  const visit = await visitContext(deps.db, tenantId, visitId);
  if (visit?.status !== "done" || !visit.customer.phone) return "skipped";
  const now = deps.now();
  const last = await lastSurveyFor(deps.db, tenantId, visit.customer.id);
  if (!surveyAllowed(last, now)) return "skipped";
  if (!(await startSurvey(deps.db, tenantId, visitId, now))) return "skipped";
  await queueSms(
    deps,
    {
      tenantId,
      to: visit.customer.phone,
      customerId: visit.customer.id,
      visitId,
      ...(visit.boat ? { boatId: visit.boat.id } : {}),
    },
    "f9_survey",
    { firm: visit.firm.name },
  );
  return "sent";
}

/**
 * The answer to F9: the score is stored; 4–5 gets the review link (when the firm has one in
 * `settings.reviewUrl`), 1–3 a task to call within 24 hours and the mechanic's reply.
 */
export async function handleSurveyAnswer(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  score: number,
): Promise<"review" | "call_back" | "skipped"> {
  const now = deps.now();
  if (!(await answerSurvey(deps.db, tenantId, visitId, score, now))) return "skipped";
  const visit = await visitContext(deps.db, tenantId, visitId);
  if (!visit?.customer.phone) return "skipped";
  const vars = visitVars(visit);
  const target = {
    tenantId,
    to: visit.customer.phone,
    customerId: visit.customer.id,
    visitId,
  };
  const followUp = surveyFollowUp(score);
  if (followUp === "review") {
    const reviewUrl = visit.firm.settings.reviewUrl;
    if (typeof reviewUrl === "string" && reviewUrl !== "") {
      await queueSms(deps, target, "f9_reply_good", {
        googleLink: reviewUrl,
        mechanicFirstName: vars.mechanicFirstName,
      });
    }
    return "review";
  }
  await createTask(deps.db, {
    tenantId,
    type: "low_csat",
    priority: "high",
    title: sv.flows.lowCsat(visit.customer.name, score),
    customerId: visit.customer.id,
    jobId: visit.jobId,
    visitId,
    dueAt: new Date(now.getTime() + 24 * 3_600_000),
  });
  await queueSms(deps, target, "f9_reply_poor", { mechanicFirstName: vars.mechanicFirstName });
  return "call_back";
}
