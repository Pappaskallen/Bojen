/**
 * What the mechanic does on the day view (byggplan step 5.5): plain forms that post here.
 *
 *   POST /api/idag/{visitId}/starta      key            → the visit starts
 *   POST /api/idag/{visitId}/klart       key            → the visit is done
 *   POST /api/idag/{visitId}/timmar      key, engineId, hours
 *   POST /api/idag/{visitId}/del         key, articleNumber, description?, quantity?
 *   POST /api/idag/{visitId}/delstatus   key, jobPartId, status
 *   POST /api/idag/{visitId}/bild        key, photo (file)
 *   POST /api/idag/{visitId}/anteckning  key, note
 *
 * Every form carries a key, so the same form sent twice, as the offline queue may after an
 * answer that never arrived, is done once (step 5.5b). Without JavaScript the answer is 303
 * back to `/idag?dag=…&klart=…#besok-{id}` (or `fel=…`). The offline queue asks for JSON
 * instead: 200 `{ ok: true }`, 422 `{ ok: false, problem }` for a refusal that will not go
 * away by itself, 500 to try again later, 401 when the person must sign in again.
 */
import { BookingError, DayError, type DayActor } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface DayRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  visitDay: (actor: DayActor, visitId: string) => Promise<string>;
  start: (actor: DayActor, visitId: string, key: string) => Promise<void>;
  complete: (actor: DayActor, visitId: string, key: string) => Promise<void>;
  hours: (
    actor: DayActor,
    visitId: string,
    key: string,
    engineId: string,
    hours: number,
  ) => Promise<void>;
  addPart: (
    actor: DayActor,
    visitId: string,
    key: string,
    input: { articleNumber: string; description?: string; quantity?: number },
  ) => Promise<void>;
  partStatus: (
    actor: DayActor,
    visitId: string,
    key: string,
    jobPartId: string,
    status: string,
  ) => Promise<void>;
  photo: (
    actor: DayActor,
    visitId: string,
    key: string,
    photo: { bytes: Uint8Array; contentType: string },
  ) => Promise<void>;
  note: (actor: DayActor, visitId: string, key: string, note: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DayAction = "starta" | "klart" | "timmar" | "del" | "delstatus" | "bild" | "anteckning";
const ACTIONS: readonly DayAction[] = [
  "starta",
  "klart",
  "timmar",
  "del",
  "delstatus",
  "bild",
  "anteckning",
];

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

async function run(
  deps: DayRouteDeps,
  actor: DayActor,
  visitId: string,
  action: DayAction,
  form: FormData,
) {
  const key = text(form, "key");
  if (!UUID.test(key)) throw new BadForm();
  switch (action) {
    case "starta":
      return deps.start(actor, visitId, key);
    case "klart":
      return deps.complete(actor, visitId, key);
    case "timmar": {
      const engineId = text(form, "engineId");
      if (!UUID.test(engineId) || !text(form, "hours")) throw new BadForm();
      return deps.hours(actor, visitId, key, engineId, number(text(form, "hours")));
    }
    case "del": {
      const quantity = text(form, "quantity");
      const description = text(form, "description");
      return deps.addPart(actor, visitId, key, {
        articleNumber: text(form, "articleNumber"),
        ...(description ? { description } : {}),
        ...(quantity ? { quantity: number(quantity) } : {}),
      });
    }
    case "delstatus": {
      const jobPartId = text(form, "jobPartId");
      if (!UUID.test(jobPartId)) throw new BadForm();
      return deps.partStatus(actor, visitId, key, jobPartId, text(form, "status"));
    }
    case "bild": {
      const file = form.get("photo");
      if (!(file instanceof File) || file.size === 0) throw new BadForm();
      return deps.photo(actor, visitId, key, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
      });
    }
    case "anteckning":
      return deps.note(actor, visitId, key, text(form, "note"));
  }
}

export function createDayRoute(deps: DayRouteDeps) {
  return async function act(request: Request, visitId: string, action: string): Promise<Response> {
    const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
    const session = await deps.session(request);
    if (session?.step !== "none") {
      return wantsJson
        ? Response.json({ ok: false, problem: "unauthorized" }, { status: 401 })
        : new Response(null, { status: 401 });
    }
    if (!UUID.test(visitId) || !ACTIONS.includes(action as DayAction)) {
      return new Response(null, { status: 404 });
    }
    const actor: DayActor = {
      tenantId: session.context.tenantId,
      userId: session.context.actor.id,
      role: session.role,
    };
    let problem: string | null = null;
    let day = "";
    try {
      day = await deps.visitDay(actor, visitId);
      const form = await request.formData().catch(() => {
        throw new BadForm();
      });
      await run(deps, actor, visitId, action as DayAction, form);
    } catch (error) {
      if (error instanceof BadForm) problem = "invalid_input";
      else {
        problem = dayProblem(error);
        if (problem === "failed") {
          console.error("[idag] action failed", error);
          // Worth trying again later: the queue keeps it.
          if (wantsJson) return Response.json({ ok: false, problem }, { status: 500 });
        }
      }
    }
    if (wantsJson) {
      return problem
        ? Response.json({ ok: false, problem }, { status: 422 })
        : Response.json({ ok: true, done: action });
    }
    // A relative address: `request.url` names the host the server listens on, which need not
    // be the one in the browser, and the sign-in cookie belongs to the browser's.
    const query = problem ? `fel=${problem}` : `klart=${action}`;
    const back = `/idag?${day ? `dag=${day}&` : ""}${query}#besok-${visitId}`;
    return new Response(null, { status: 303, headers: { location: back } });
  };
}
