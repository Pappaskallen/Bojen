/**
 * Showing a boat's access information from the boat card (byggplan step 5.2, spec 10.4).
 *
 *   POST /api/batar/{id}/atkomst   { "confirm": true }   → 200 { code, keyLocation, … }
 *
 * Only for a signed-in member of the firm, from the firm's own pages (the same-site check in
 * `staffFromRequest`), and only after the confirmation on the page: a request without it is
 * refused before anything is read. Whether the person may see it at all is the rule in
 * `revealBoatAccess`, which logs every attempt. The answer is never cached, and nothing here
 * writes the code to a log.
 */
import { AccessDeniedError, type RevealedAccess } from "@bojen/db";
import type { RequestContext } from "./bookings";

export interface BoatAccessDeps {
  authorize: (request: Request) => Promise<RequestContext | null>;
  reveal: (userId: string, boatId: string) => Promise<RevealedAccess>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE });

/** What the page may show: the codes as text, or null where nothing is stored. */
export interface ShownAccess {
  code: string | null;
  keyLocation: string | null;
  gateCode: string | null;
  keyBox: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export function createBoatAccessRoute(deps: BoatAccessDeps) {
  return async function reveal(request: Request, boatId: string): Promise<Response> {
    const caller = await deps.authorize(request);
    if (!caller || caller.actor.type !== "staff" || !caller.actor.id) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!UUID.test(boatId)) return json({ error: "not_found" }, 404);
    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
    if (body?.confirm !== true) return json({ error: "confirmation_required" }, 400);

    try {
      const shown = await deps.reveal(caller.actor.id, boatId);
      const answer: ShownAccess = {
        code: shown.code?.reveal() ?? null,
        keyLocation: shown.keyLocation?.reveal() ?? null,
        gateCode: shown.gateCode?.reveal() ?? null,
        keyBox: shown.keyBox?.reveal() ?? null,
        contactName: shown.contactName,
        contactPhone: shown.contactPhone,
      };
      return json(answer, 200);
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        const status = error.reason === "boat_not_found" ? 404 : 403;
        return json({ error: "access_denied", reason: error.reason }, status);
      }
      throw error;
    }
  };
}
