/**
 * The codes the phone keeps for a visit (byggplan step 5.5c).
 *
 *   POST /api/idag/{visitId}/koder   → 200 { code, keyLocation, gateCode, keyBox, deleteBy }
 *
 * Through the access rule of step 1.6 (the visit's own mechanic within 12 hours of its start,
 * or the owner), and every download is logged. The phone encrypts them at once with the key
 * from the mechanic's passkey; the answer itself is never cached.
 */
import { AccessDeniedError, type PhoneCodes } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface CodesRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  codes: (userId: string, visitId: string) => Promise<PhoneCodes>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function createCodesRoute(deps: CodesRouteDeps) {
  return async function codes(request: Request, visitId: string): Promise<Response> {
    const session = await deps.session(request);
    if (session?.step !== "none") {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    }
    if (!UUID.test(visitId))
      return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    try {
      const c = await deps.codes(session.context.actor.id, visitId);
      return Response.json({ ...c, deleteBy: c.deleteBy.toISOString() }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return Response.json(
          { error: "access_denied", reason: error.reason },
          { status: 403, headers: NO_STORE },
        );
      }
      throw error;
    }
  };
}
