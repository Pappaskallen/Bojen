/**
 * Whether a booking the customer makes waits for the mechanic's approval (byggplan step 2.6,
 * spec W5). Rules are per service and customer type; an empty field means "all".
 *
 * The most specific rule wins: service and customer type, then service only, then customer
 * type only, then a rule for everything. Without a matching rule new customers are approved
 * by hand and existing customers are booked at once, as in W5. Emergencies are always
 * approved by hand, whatever the rules say.
 */

export type CustomerKind = "new" | "existing";
export type ApprovalMode = "auto" | "manual";

export interface ApprovalRule {
  serviceTypeId: string | null;
  customerKind: CustomerKind | null;
  mode: ApprovalMode;
}

export interface ApprovalQuestion {
  rules: readonly ApprovalRule[];
  serviceTypeId: string;
  customerKind: CustomerKind;
  urgency?: "planned" | "soon" | "emergency";
}

export const DEFAULT_APPROVAL: Readonly<Record<CustomerKind, ApprovalMode>> = {
  new: "manual",
  existing: "auto",
};

function specificity(rule: ApprovalRule): number {
  return (rule.serviceTypeId ? 2 : 0) + (rule.customerKind ? 1 : 0);
}

/** The rule that decides, or null when the default applies. */
export function matchingRule(question: ApprovalQuestion): ApprovalRule | null {
  const matching = question.rules.filter(
    (r) =>
      (r.serviceTypeId === null || r.serviceTypeId === question.serviceTypeId) &&
      (r.customerKind === null || r.customerKind === question.customerKind),
  );
  return matching.sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
}

export function needsApproval(question: ApprovalQuestion): boolean {
  if (question.urgency === "emergency") return true;
  const mode = matchingRule(question)?.mode ?? DEFAULT_APPROVAL[question.customerKind];
  return mode === "manual";
}
