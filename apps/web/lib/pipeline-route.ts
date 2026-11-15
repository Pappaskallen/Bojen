/**
 * Moving a card on the pipeline (byggplan step 5.4).
 *
 *   POST /api/pipeline/{jobId}   { "to": "quote" }   → 200 { status }
 *
 * For a signed-in member of the firm with both factors done, from the firm's own pages (the
 * same-site check in `sessionFromRequest`). Who may move which card is `moveCard`'s business.
 */
import { PipelineError, type PipelineMover } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface PipelineRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  move: (mover: PipelineMover, jobId: string, to: unknown) => Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = { invalid_input: 400, forbidden: 403, not_found: 404 } as const;

export function createPipelineRoute(deps: PipelineRouteDeps) {
  return async function move(request: Request, jobId: string): Promise<Response> {
    const session = await deps.session(request);
    if (session?.step !== "none") return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!UUID.test(jobId)) return Response.json({ error: "not_found" }, { status: 404 });
    const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
    try {
      const status = await deps.move(
        {
          tenantId: session.context.tenantId,
          userId: session.context.actor.id,
          role: session.role,
        },
        jobId,
        body?.to,
      );
      return Response.json({ status });
    } catch (error) {
      if (error instanceof PipelineError) {
        return Response.json({ error: error.code }, { status: STATUS[error.code] });
      }
      throw error;
    }
  };
}
