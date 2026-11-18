/**
 * The mechanic's decision on a type plate suggestion on the boat card (byggplan step 6.3).
 *
 *   POST /api/batar/{boatId}/typskylt/{readingId}   do=confirm|dismiss, engineId (or "ny")
 *        → 303 /batar/{boatId}?typskylt=confirmed|dismissed#motorer (or ?typskyltfel=…)
 *
 * Every signed-in staff member may decide, as every one may read the boat card.
 */
import { NameplateError, type DayActor } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface NameplateRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  decide: (
    actor: DayActor,
    readingId: string,
    decision: "confirm" | "dismiss",
    engineId?: string | "new",
  ) => Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createNameplateRoute(deps: NameplateRouteDeps) {
  return async function decide(request: Request, boatId: string, readingId: string) {
    const session = await deps.session(request);
    if (session?.step !== "none") return new Response(null, { status: 401 });
    if (!UUID.test(boatId) || !UUID.test(readingId)) return new Response(null, { status: 404 });
    const actor: DayActor = {
      tenantId: session.context.tenantId,
      userId: session.context.actor.id,
      role: session.role,
    };
    const form = await request.formData().catch(() => null);
    const what = form?.get("do");
    const engine = form?.get("engineId");
    const back = (query: string) =>
      new Response(null, {
        status: 303,
        headers: { location: `/batar/${boatId}?${query}#motorer` },
      });
    if (what !== "confirm" && what !== "dismiss") return back("typskyltfel=failed");
    try {
      await deps.decide(
        actor,
        readingId,
        what,
        engine === "ny"
          ? "new"
          : typeof engine === "string" && UUID.test(engine)
            ? engine
            : undefined,
      );
      return back(`typskylt=${what === "confirm" ? "confirmed" : "dismissed"}`);
    } catch (error) {
      if (error instanceof NameplateError) return back(`typskyltfel=${error.code}`);
      console.error("[typskylt] decision failed", (error as Error).name);
      return back("typskyltfel=failed");
    }
  };
}
