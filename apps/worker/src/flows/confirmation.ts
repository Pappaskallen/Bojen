import { bookingSettings, cancelBy, sv } from "@bojen/core";
import { alreadySent, confirmationOwed, queueEmail, queueSms, visitContext } from "@bojen/db";
import { type FlowDeps, visitVars } from "./deps";
import { scheduleEta } from "./morningEta";

const kr = (ore: number) =>
  new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(ore / 100);

/**
 * F1, booking confirmation: when a visit becomes `booked`, the customer gets an sms (if they
 * have a mobile) and an e-mail (if they have an address), once per visit. Then F5 is put in
 * for 07:00 on the day.
 *
 * The e-mail never shows the code, and here not the key place either: it is encrypted
 * access information and is not decrypted for e-mail.
 */
export async function sendConfirmation(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  /** After the customer rescheduled through the link: a new confirmation with a new link. */
  options: { afterCustomerChange?: boolean } = {},
): Promise<"sent" | "skipped"> {
  const visit = await visitContext(deps.db, tenantId, visitId);
  if (visit?.status !== "booked") return "skipped";
  const channel = visit.customer.phone ? "sms" : "email";
  const owed = options.afterCustomerChange
    ? await confirmationOwed(deps.db, tenantId, visitId, channel)
    : !(await alreadySent(deps.db, tenantId, visitId, "f1_confirmation"));
  if (!owed) return "skipped";

  const vars = visitVars(visit);
  const link = await deps.link(visit, "manage");
  const target = {
    tenantId,
    customerId: visit.customer.id,
    visitId,
    ...(visit.boat ? { boatId: visit.boat.id } : {}),
  };
  if (visit.customer.phone) {
    await queueSms(deps, { ...target, to: visit.customer.phone }, "f1_confirmation", {
      firstName: vars.firstName,
      serviceShort: vars.serviceShort,
      weekday: vars.weekday,
      date: vars.date,
      window: vars.window,
      placeShort: vars.placeShort,
      link,
      firm: vars.firm,
    });
  }
  if (visit.customer.email) {
    const settings = bookingSettings(visit.firm.settings);
    const price = visit.service?.priceOre;
    await queueEmail(deps, { ...target, to: visit.customer.email }, "f1_confirmation", {
      ...vars,
      keyText: sv.flows.keyText,
      priceIndication: price ? kr(price) : sv.flows.priceUnknown,
      preparation: visit.service?.preparationText ?? sv.flows.preparation,
      link,
      cancelBy: cancelBy(visit.start, settings.customerChangeCutoffHours),
      web: link.split("/")[0] ?? link,
    });
  }
  await scheduleEta(deps, visit);
  return "sent";
}
