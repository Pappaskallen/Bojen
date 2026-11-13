/**
 * What the mechanic does on the day view (byggplan step 5.5): plain forms that post here and
 * come back to `/idag`, so they work without JavaScript; step 5.5b puts an offline queue in
 * front of them.
 *
 *   POST /api/idag/{visitId}/starta      key            → the visit starts
 *   POST /api/idag/{visitId}/klart       key            → the visit is done
 *   POST /api/idag/{visitId}/timmar      engineId, hours
 *   POST /api/idag/{visitId}/del         articleNumber, description?, quantity?
 *   POST /api/idag/{visitId}/delstatus   jobPartId, status
 *   POST /api/idag/{visitId}/bild        photo (file)
 *
 * Each answers 303 to `/idag?dag=…&klart=…#besok-{id}`, or with `fel=…` when refused.
 */
import { BookingError, DayError, type DayActor } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface DayRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  visitDay: (actor: DayActor, visitId: string) => Promise<string>;
  start: (actor: DayActor, visitId: string, key: string) => Promise<void>;
  complete: (actor: DayActor, visitId: string, key: string) => Promise<void>;
  hours: (actor: DayActor, visitId: string, engineId: string, hours: number) => Promise<void>;
  addPart: (
    actor: DayActor,
    visitId: string,
    input: { articleNumber: string; description?: string; quantity?: number },
  ) => Promise<void>;
  partStatus: (
    actor: DayActor,
    visitId: string,
    jobPartId: string,
    status: string,
  ) => Promise<void>;
  photo: (
    actor: DayActor,
    visitId: string,
    photo: { bytes: Uint8Array; contentType: string },
  ) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DayAction = "starta" | "klart" | "timmar" | "del" | "delstatus" | "bild";
const ACTIONS: readonly DayAction[] = ["starta", "klart", "timmar", "del", "delstatus", "bild"];

/** Which message the page shows for a refusal. */
export function dayProblem(error: unknown): string {
  if (error instanceof DayError) return error.code;
  if (error instanceof BookingError) {
    if (error.code === "invalid_transition") return "wrong_state";
    if (error.code === "not_found" || error.code === "forbidden") return error.code;
    return "failed";
  }
  return "failed";
}

class BadForm extends Error {}

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const number = (value: string) => Number(value.replace(",", ".").replace(/\s/g, ""));

export function createDayRoute(deps: DayRouteDeps) {
  return async function act(request: Request, visitId: string, action: string): Promise<Response> {
    const session = await deps.session(request);
    if (session?.step !== "none") return new Response(null, { status: 401 });
    if (!UUID.test(visitId) || !ACTIONS.includes(action as DayAction)) {
      return new Response(null, { status: 404 });
    }
    const actor: DayActor = {
      tenantId: session.context.tenantId,
      userId: session.context.actor.id,
      role: session.role,
    };
    let query = `klart=${action}`;
    let day = "";
    try {
      day = await deps.visitDay(actor, visitId);
      const form = await request.formData().catch(() => {
        throw new BadForm();
      });
      switch (action as DayAction) {
        case "starta":
        case "klart": {
          const key = text(form, "key");
          if (!UUID.test(key)) throw new BadForm();
          await (action === "starta" ? deps.start : deps.complete)(actor, visitId, key);
          break;
        }
        case "timmar": {
          const engineId = text(form, "engineId");
          const hours = number(text(form, "hours"));
          if (!UUID.test(engineId) || !text(form, "hours")) throw new BadForm();
          await deps.hours(actor, visitId, engineId, hours);
          break;
        }
        case "del": {
          const quantity = text(form, "quantity");
          const description = text(form, "description");
          await deps.addPart(actor, visitId, {
            articleNumber: text(form, "articleNumber"),
            ...(description ? { description } : {}),
            ...(quantity ? { quantity: number(quantity) } : {}),
          });
          break;
        }
        case "delstatus": {
          const jobPartId = text(form, "jobPartId");
          if (!UUID.test(jobPartId)) throw new BadForm();
          await deps.partStatus(actor, visitId, jobPartId, text(form, "status"));
          break;
        }
        case "bild": {
          const file = form.get("photo");
          if (!(file instanceof File) || file.size === 0) throw new BadForm();
          await deps.photo(actor, visitId, {
            bytes: new Uint8Array(await file.arrayBuffer()),
            contentType: file.type,
          });
          break;
        }
      }
    } catch (error) {
      if (error instanceof BadForm) query = "fel=invalid_input";
      else {
        const problem = dayProblem(error);
        if (problem === "failed") console.error("[idag] action failed", error);
        query = `fel=${problem}`;
      }
    }
    // A relative address: `request.url` names the host the server listens on, which need not
    // be the one in the browser, and the sign-in cookie belongs to the browser's.
    const back = `/idag?${day ? `dag=${day}&` : ""}${query}#besok-${visitId}`;
    return new Response(null, { status: 303, headers: { location: back } });
  };
}
