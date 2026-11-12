/**
 * When staff must use a second factor (byggplan step 2.8, spec 10.7). Owners and admins
 * always; a mechanic who has added an authenticator app too, so it cannot be skipped.
 */
export type StaffRole = "owner" | "admin" | "mechanic";

export function secondFactorRequired(staff: {
  role: StaffRole | null;
  hasFactor: boolean;
}): boolean {
  return staff.role === "owner" || staff.role === "admin" || staff.hasFactor;
}

/** What a signed-in staff member has to do before the staff pages open. */
export type SecondFactorStep = "none" | "enroll" | "challenge";

export function secondFactorStep(staff: {
  role: StaffRole | null;
  hasFactor: boolean;
  aal: "aal1" | "aal2";
}): SecondFactorStep {
  if (staff.aal === "aal2" || !secondFactorRequired(staff)) return "none";
  return staff.hasFactor ? "challenge" : "enroll";
}
