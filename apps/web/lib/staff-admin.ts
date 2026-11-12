/**
 * What the owner can do for the rest of the staff (byggplan step 2.8, spec 10.4):
 *
 *   POST /api/staff/{id}/revoke        → 204; every session of that person ends at once
 *   POST /api/staff/{id}/reset-factor  → 204; their authenticator app is removed
 *
 * Only an owner with a complete session (second factor done) may do either. Both are
 * written to `audit_log`.
 */
import type { StaffAuth } from "@bojen/core";
import {
  StaffActionError,
  listStaff,
  recordSecondFactorReset,
  revokeStaffSessions,
  type Database,
} from "@bojen/db";
import { sessionFromRequest } from "./staff-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createStaffAdminRoutes(deps: { db: () => Database; auth: () => StaffAuth }) {
  async function asOwner(
    request: Request,
    targetId: string,
    work: (owner: { tenantId: string; appUserId: string }) => Promise<void>,
  ) {
    const session = await sessionFromRequest(deps.auth(), request);
    if (!session || session.step !== "none")
      return Response.json({ error: "unauthorized" }, { status: 401 });
    if (session.role !== "owner") return Response.json({ error: "forbidden" }, { status: 403 });
    if (!UUID.test(targetId)) return Response.json({ error: "invalid_input" }, { status: 400 });
    try {
      await work({ tenantId: session.context.tenantId, appUserId: session.context.actor.id });
    } catch (error) {
      if (error instanceof StaffActionError) {
        return Response.json(
          { error: error.reason },
          { status: error.reason === "forbidden" ? 403 : 404 },
        );
      }
      throw error;
    }
    return new Response(null, { status: 204 });
  }

  return {
    revoke: (request: Request, targetId: string) =>
      asOwner(request, targetId, async (owner) => {
        await revokeStaffSessions(deps.db(), { ...owner, role: "owner" }, targetId);
      }),

    resetFactor: (request: Request, targetId: string) =>
      asOwner(request, targetId, async (owner) => {
        const target = (await listStaff(deps.db(), owner.tenantId)).find((s) => s.id === targetId);
        if (!target) throw new StaffActionError("not_found");
        if (target.authUserId) await deps.auth().removeFactors(target.authUserId);
        await recordSecondFactorReset(deps.db(), owner, targetId, "owner_reset");
      }),
  };
}
