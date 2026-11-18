/**
 * The receptionist's messages in the mechanic's view, and web push (byggplan step 6.4).
 *
 *   POST /api/arenden/{taskId}   do=take|done → 303 /idag/arenden (or ?arendefel=gone)
 *   POST /api/push               { endpoint, keys: { p256dh, auth } } → 204, this phone gets push
 *   DELETE /api/push             { endpoint } → 204
 *
 * Every signed-in staff member may take a message: whoever is free calls back.
 */
import type { StaffSession } from "./staff-auth";

interface Actor {
  tenantId: string;
  userId: string;
}

export interface TasksRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  decide: (actor: Actor, taskId: string, decision: "take" | "done") => Promise<boolean>;
  subscribe: (
    actor: Actor,
    input: { endpoint: string; p256dh: string; auth: string },
  ) => Promise<void>;
  unsubscribe: (actor: Actor, endpoint: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL = /^[A-Za-z0-9_-]{8,200}={0,2}$/;

/** A push service's address: https, and not a place inside our own network. */
function pushEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|\[)/.test(url.hostname)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function createTasksRoute(deps: TasksRouteDeps) {
  async function actorOf(request: Request): Promise<Actor | null> {
    const session = await deps.session(request);
    if (session?.step !== "none") return null;
    return { tenantId: session.context.tenantId, userId: session.context.actor.id };
  }

  return {
    async decide(request: Request, taskId: string): Promise<Response> {
      const actor = await actorOf(request);
      if (!actor) return new Response(null, { status: 401 });
      const back = (query = "") =>
        new Response(null, { status: 303, headers: { location: `/idag/arenden${query}` } });
      const form = await request.formData().catch(() => null);
      const what = form?.get("do");
      if (!UUID.test(taskId) || (what !== "take" && what !== "done"))
        return back("?arendefel=gone");
      return (await deps.decide(actor, taskId, what)) ? back() : back("?arendefel=gone");
    },

    async push(request: Request): Promise<Response> {
      const actor = await actorOf(request);
      if (!actor) return new Response(null, { status: 401 });
      const body = (await request.json().catch(() => null)) as {
        endpoint?: unknown;
        keys?: { p256dh?: unknown; auth?: unknown };
      } | null;
      const endpoint = pushEndpoint(body?.endpoint);
      if (!endpoint) return Response.json({ error: "invalid_input" }, { status: 400 });
      if (request.method === "DELETE") {
        await deps.unsubscribe(actor, endpoint);
        return new Response(null, { status: 204 });
      }
      const p256dh = body?.keys?.p256dh;
      const auth = body?.keys?.auth;
      if (
        typeof p256dh !== "string" ||
        typeof auth !== "string" ||
        !B64URL.test(p256dh) ||
        !B64URL.test(auth)
      ) {
        return Response.json({ error: "invalid_input" }, { status: 400 });
      }
      await deps.subscribe(actor, { endpoint, p256dh, auth });
      return new Response(null, { status: 204 });
    },
  };
}
