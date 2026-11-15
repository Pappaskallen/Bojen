/**
 * Who may see a boat's access code, and when (spec 10.4 and 10.6).
 *
 * - The mechanic who has the visit, from 12 hours before to 12 hours after its start.
 * - The owner of the firm at any time; every view is logged.
 * - Nobody else, administrators included.
 */
export const ACCESS_WINDOW_MS = 12 * 60 * 60 * 1000;

export type AccessRole = "owner" | "admin" | "mechanic";

export type AccessDecision =
  | { allowed: true; reason: "assigned_mechanic" | "owner" }
  | { allowed: false; reason: "not_assigned" | "outside_window" | "role_not_allowed" };

export interface AccessRequest {
  userId: string;
  role: AccessRole;
  visit: { mechanicId: string | null; start: Date };
  now: Date;
}

export function decideAccess({ userId, role, visit, now }: AccessRequest): AccessDecision {
  if (role === "owner") return { allowed: true, reason: "owner" };
  if (role !== "mechanic") return { allowed: false, reason: "role_not_allowed" };
  if (visit.mechanicId !== userId) return { allowed: false, reason: "not_assigned" };

  const offset = now.getTime() - visit.start.getTime();
  if (Math.abs(offset) > ACCESS_WINDOW_MS) return { allowed: false, reason: "outside_window" };
  return { allowed: true, reason: "assigned_mechanic" };
}

export interface BoatVisit {
  id: string;
  mechanicId: string | null;
  start: Date;
}

export type BoatAccessDecision =
  | { allowed: true; reason: "owner"; visitId: null }
  | { allowed: true; reason: "assigned_mechanic"; visitId: string }
  | { allowed: false; reason: "not_assigned" | "outside_window" | "role_not_allowed" };

/**
 * The same rule from the boat card (step 5.2), where there is no single visit: the owner at
 * any time, and a mechanic through one of their own visits to the boat that starts within 12
 * hours, the nearest one. A mechanic with visits to the boat that are all further off hears
 * that it is outside the window; one without any visit, that the boat is not theirs.
 */
export function decideBoatAccess(input: {
  userId: string;
  role: AccessRole;
  visits: readonly BoatVisit[];
  now: Date;
}): BoatAccessDecision {
  const { userId, role, visits, now } = input;
  if (role === "owner") return { allowed: true, reason: "owner", visitId: null };
  if (role !== "mechanic") return { allowed: false, reason: "role_not_allowed" };
  const own = visits
    .filter((v) => v.mechanicId === userId)
    .sort(
      (a, b) =>
        Math.abs(a.start.getTime() - now.getTime()) - Math.abs(b.start.getTime() - now.getTime()),
    );
  const nearest = own[0];
  if (!nearest) return { allowed: false, reason: "not_assigned" };
  const decision = decideAccess({ userId, role, visit: nearest, now });
  return decision.allowed
    ? { allowed: true, reason: "assigned_mechanic", visitId: nearest.id }
    : { allowed: false, reason: decision.reason };
}
