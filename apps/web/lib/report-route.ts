import { safeError } from "@bojen/core/logging";
/**
 * The service report page's form (byggplan step 5.5d). It needs coverage: the draft is
 * written on the server, and the approval sends the report to the customer.
 *
 *   POST /api/idag/{visitId}/rapport   workDone, rec-text-N, rec-priority-N, nextService, and
 *     do=spara          save the text
 *     do=godkann        save and approve (F7)
 *     do=rad            lineType, description, quantity, unitPrice (kr): add a line
 *     do=bort:{lineId}  remove a line
 *
 * The page is one form, so adding or removing a line first keeps the text written so far
 * (when there is any: an empty text must not stop the draft that is still being written).
 * The answer is 303 back to `/idag/rapport/{visitId}?klart=…` (or `fel=…`).
 */
import { parseKronor } from "@bojen/core";
import { ReportError, type DayActor, type ReportInput } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface ReportRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  save: (actor: DayActor, visitId: string, input: ReportInput) => Promise<void>;
  approve: (actor: DayActor, visitId: string, input: ReportInput) => Promise<void>;
  addLine: (
    actor: DayActor,
    visitId: string,
    line: { type: string; description: string; quantity: number; unitPriceOre: number },
  ) => Promise<unknown>;
  removeLine: (actor: DayActor, visitId: string, lineId: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE: Record<string, string> = {
  spara: "sparat",
  godkann: "godkand",
  rad: "rad",
  bort: "bort",
};
/** At most this many recommendation rows are read from one form. */
const MAX_ROWS = 20;

class BadForm extends Error {}

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** The report's text fields; empty recommendation rows are left out. */
export function reportInput(form: FormData): ReportInput {
  const recommendations: ReportInput["recommendations"] = [];
  for (let i = 0; i < MAX_ROWS; i++) {
    const t = text(form, `rec-text-${String(i)}`);
    if (t) recommendations.push({ text: t, priority: text(form, `rec-priority-${String(i)}`) });
  }
  return {
    workDone: text(form, "workDone"),
    recommendations,
    nextService: text(form, "nextService"),
  };
}

function lineInput(form: FormData) {
  const quantityText = text(form, "quantity").replace(",", ".").replace(/\s/g, "");
  const quantity = quantityText ? Number(quantityText) : 1;
  const unitPriceOre = parseKronor(text(form, "unitPrice"));
  if (!Number.isFinite(quantity) || unitPriceOre === null) throw new BadForm();
  return {
    type: text(form, "lineType"),
    description: text(form, "description"),
    quantity,
    unitPriceOre,
  };
}

export function createReportRoute(deps: ReportRouteDeps) {
  return async function report(request: Request, visitId: string): Promise<Response> {
    const session = await deps.session(request);
    if (session?.step !== "none") return new Response(null, { status: 401 });
    if (!UUID.test(visitId)) return new Response(null, { status: 404 });
    const actor: DayActor = {
      tenantId: session.context.tenantId,
      userId: session.context.actor.id,
      role: session.role,
    };
    let problem: string | null = null;
    let done = "";
    try {
      const form = await request.formData().catch(() => {
        throw new BadForm();
      });
      const [what = "", lineId = ""] = text(form, "do").split(":");
      done = DONE[what] ?? "";
      const keepText = async () => {
        const input = reportInput(form);
        if (input.workDone) await deps.save(actor, visitId, input);
      };
      switch (what) {
        case "spara":
          await deps.save(actor, visitId, reportInput(form));
          break;
        case "godkann":
          await deps.approve(actor, visitId, reportInput(form));
          break;
        case "rad": {
          const line = lineInput(form);
          await keepText();
          await deps.addLine(actor, visitId, line);
          break;
        }
        case "bort":
          if (!UUID.test(lineId)) throw new BadForm();
          await keepText();
          await deps.removeLine(actor, visitId, lineId);
          break;
        default:
          throw new BadForm();
      }
    } catch (error) {
      if (error instanceof BadForm) problem = "invalid_input";
      else if (error instanceof ReportError) problem = error.code;
      else {
        console.error("[rapport] action failed", safeError(error));
        problem = "failed";
      }
    }
    const query = problem ? `fel=${problem}` : `klart=${done}`;
    // Relative, as on the day view: the browser's host, not the server's.
    return new Response(null, {
      status: 303,
      headers: { location: `/idag/rapport/${visitId}?${query}` },
    });
  };
}
