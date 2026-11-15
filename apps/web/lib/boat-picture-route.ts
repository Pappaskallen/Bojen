/**
 * The picture of the visit's boat on the day view (byggplan step 5.5d), so the mechanic sees
 * at once which boat it is.
 *
 *   GET /api/idag/{visitId}/batbild   → the picture, or 404 when the boat has none
 *
 * The address stays the same, unlike a signed link, so the service worker can keep the
 * picture with the day view and show it without coverage. Only for those who may work on
 * the visit; the answer may be kept by the phone, never by anything in between.
 */
import { DayError, type DayActor } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface BoatPictureRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  picture: (
    actor: DayActor,
    visitId: string,
  ) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createBoatPictureRoute(deps: BoatPictureRouteDeps) {
  return async function boatPicture(request: Request, visitId: string): Promise<Response> {
    const session = await deps.session(request);
    if (session?.step !== "none") return new Response(null, { status: 401 });
    if (!UUID.test(visitId)) return new Response(null, { status: 404 });
    const actor: DayActor = {
      tenantId: session.context.tenantId,
      userId: session.context.actor.id,
      role: session.role,
    };
    try {
      const picture = await deps.picture(actor, visitId);
      if (!picture?.contentType.startsWith("image/")) return new Response(null, { status: 404 });
      return new Response(picture.bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          "Content-Type": picture.contentType,
          "Cache-Control": "private, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof DayError && (error.code === "not_found" || error.code === "forbidden")) {
        return new Response(null, { status: error.code === "forbidden" ? 403 : 404 });
      }
      throw error;
    }
  };
}
