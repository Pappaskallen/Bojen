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
