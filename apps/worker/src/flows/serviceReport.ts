import { sv } from "@bojen/core";
import { alreadySent, queueEmail, queueSms, visitContext } from "@bojen/db";
import { type FlowDeps, visitVars } from "./deps";

/** What the day view (step 5.5) puts in `report.approved`. Missing parts read "–". */
export interface ReportContent {
  workDone?: string;
  hours?: string;
  previousHours?: string;
  parts?: string;
  recommendations?: string;
  nextService?: string;
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value : sv.flows.unknown;

/**
 * F7, the service report: when the mechanic approves the report, the customer gets an sms
 * and an e-mail with the link. Invoice and payment link come with Fortnox (step 8).
 */
export async function sendServiceReport(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  report: ReportContent,
): Promise<"sent" | "skipped"> {
  const visit = await visitContext(deps.db, tenantId, visitId);
  if (!visit) return "skipped";
  if (await alreadySent(deps.db, tenantId, visitId, "f7_report")) return "skipped";
  const vars = visitVars(visit);
  const link = deps.link(visit, "report");
  const target = {
    tenantId,
    customerId: visit.customer.id,
    visitId,
    ...(visit.boat ? { boatId: visit.boat.id } : {}),
  };
  if (visit.customer.phone) {
    await queueSms(deps, { ...target, to: visit.customer.phone }, "f7_report", {
      serviceShort: vars.serviceShort,
      boat: vars.boat,
      link,
      firm: vars.firm,
    });
  }
  if (visit.customer.email) {
    await queueEmail(deps, { ...target, to: visit.customer.email }, "f7_report", {
      ...vars,
      workDone: text(report.workDone),
      hours: text(report.hours),
      previousHours: text(report.previousHours),
      parts: text(report.parts),
      recommendations: text(report.recommendations),
      nextService: text(report.nextService),
      galleryLink: link,
    });
  }
  return "sent";
}
