import { HOLD_DAYS, dayMonth, nextRound, sv } from "@bojen/core";
import {
  afterRound,
  answerCampaign,
  holdTime,
  markBoatSold,
  markSent,
  openRecommendations,
  pendingRecipients,
  queueEmail,
  queueSms,
  recipientForVisit,
  releaseUnanswered,
  visitContext,
} from "@bojen/db";
import type { MapsProvider } from "@bojen/core";
import { type FlowDeps, visitVars } from "./deps";

export { CAMPAIGN_RELEASE_TASK, CAMPAIGN_ROUND_TASK } from "@bojen/db";

export interface CampaignDeps extends FlowDeps {
  maps: MapsProvider;
}

const DAY = 86_400_000;

/**
 * One round of the spring campaign (F11, byggplan step 5.6): the next recipients, marina by
 * marina, each get a held time in last year's week and an sms (or e-mail without a mobile).
 * The held time is released after 14 days without an answer. The next round is put in for
 * the next Tuesday–Thursday 18:30 while anyone is left.
 */
export async function sendCampaignRound(
  deps: CampaignDeps,
  tenantId: string,
  campaignId: string,
): Promise<string> {
  const { rules, discountPercent, recipients } = await pendingRecipients(
    deps,
    tenantId,
    campaignId,
  );
  const round = nextRound(
    recipients.map((r) => ({ ...r, when: r.target.monday })),
    rules.batchSize,
  );
  let sent = 0;
  for (const r of round) {
    const visitId = await holdTime(deps, tenantId, campaignId, rules, r);
    if (!visitId) continue;
    const visit = await visitContext(deps.db, tenantId, visitId);
    if (!visit) continue;
    const vars = visitVars(visit);
    const now = deps.now();
    const releaseAt = new Date(now.getTime() + HOLD_DAYS * DAY);
    const target = { tenantId, customerId: r.customerId, boatId: r.boatId, visitId };
    if (r.phone) {
      if (discountPercent) {
        await queueSms(deps, { ...target, to: r.phone }, "f11_spring_discount", {
          firstName: vars.firstName,
          week: String(r.target.lastWeek ?? ""),
          discount: String(discountPercent),
          weekday: vars.weekday,
          date: vars.date,
          placeShort: vars.placeShort,
          firm: vars.firm,
        });
      } else if (r.segment === "A") {
        await queueSms(deps, { ...target, to: r.phone }, "f11_spring_a", {
          firstName: vars.firstName,
          boat: vars.boat,
          lastWeek: String(r.target.lastWeek ?? ""),
          weekday: vars.weekday,
          date: vars.date,
          window: vars.window,
          placeShort: vars.placeShort,
          firm: vars.firm,
        });
      } else {
        await queueSms(deps, { ...target, to: r.phone }, "f11_spring_b", {
          firstName: vars.firstName,
          boat: vars.boat,
          date: `${vars.weekday} ${vars.date}`,
          placeShort: vars.placeShort,
          firm: vars.firm,
        });
      }
    } else if (r.email) {
      const recommendations = await openRecommendations(deps.db, tenantId, r.boatId);
      await queueEmail(deps, { ...target, to: r.email }, "f11_spring", {
        firstName: vars.firstName,
        boat: vars.boat,
        boatMake: vars.boatMake,
        boatModel: vars.boatModel,
        lastWeek: String(r.target.lastWeek ?? "–"),
        weekday: vars.weekday,
        date: vars.date,
        window: vars.window,
        placeName: vars.placeName,
        bookLink: await deps.link(visit, "manage"),
        otherLink: await deps.link(visit, "rebook"),
        serviceContents: visit.service?.preparationText ?? vars.service,
        openRecommendations:
          recommendations.length > 0 ? recommendations.join(", ") : sv.flows.unknown,
        reservedUntil: dayMonth(releaseAt),
        mechanicName: vars.mechanicName,
        firm: vars.firm,
      });
    }
    await markSent(deps.db, tenantId, r.recipientId, visitId, now, releaseAt);
    sent++;
  }
  const left = recipients.length - round.length;
  await afterRound(deps.db, tenantId, campaignId, left, deps.now());
  return `sent ${String(sent)}, left ${String(left)}`;
}

export type CampaignAnswer = "booked" | "other_times" | "declined" | "ignored";

/**
 * The answer to a held time. JA books it, and the visit's `visit.accept` sends F1. ANNAN
 * releases it and sends the link to the booking page. NEJ releases it and asks whether the
 * boat is sold.
 */
export async function handleCampaignAnswer(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  intent: "yes" | "another_time" | "no",
): Promise<CampaignAnswer> {
  const target = await recipientForVisit(deps.db, tenantId, visitId);
  if (!target) return "ignored";
  const answer = intent === "yes" ? "yes" : intent === "no" ? "no" : "other";
  const visit = await visitContext(deps.db, tenantId, visitId);
  const outcome = await answerCampaign(deps, tenantId, target, answer);
  if (outcome === "ignored" || !visit) return "ignored";
  if (answer === "yes") return "booked";
  const to = visit.customer.phone;
  const where = {
    tenantId,
    to,
    customerId: target.customerId,
    visitId,
    ...(target.boatId ? { boatId: target.boatId } : {}),
  };
  if (answer === "other") {
    await queueSms(deps, where, "f11_other_times", {
      link: await deps.link(visit, "rebook"),
      firm: visit.firm.name,
    });
    return "other_times";
  }
  await queueSms(deps, where, "f11_sold_question", { firm: visit.firm.name });
  return "declined";
}

/** SÅLD: the boat is marked sold and leaves the campaigns. */
export async function handleSoldAnswer(deps: FlowDeps, tenantId: string, visitId: string) {
  return markBoatSold(deps.db, tenantId, visitId);
}

/** Fourteen days without an answer: the held time goes back to the calendar. */
export function releaseCampaignHold(deps: FlowDeps, tenantId: string, recipientId: string) {
  return releaseUnanswered(deps, tenantId, recipientId);
}
