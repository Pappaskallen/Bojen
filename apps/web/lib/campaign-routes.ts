import { safeError } from "@bojen/core/logging";
/**
 * The campaign pages' forms (byggplan step 5.6). Only the owner and administrators create
 * and start campaigns; a mechanic may look.
 *
 *   POST /api/kampanjer               name, year, startDate, spring[], layUp[], bookService,
 *                                     batchSize, defaultWeek, discount → a draft
 *   POST /api/kampanjer/{id}/starta   → the recipients are added and the first round planned
 *
 * The answer is 303 back to the campaign (or the list), with `klart=…` or `fel=…`.
 */
import { stockholmInstant } from "@bojen/core";
import { CampaignError, type NewSpringCampaign } from "@bojen/db";
import type { StaffSession } from "./staff-auth";

export interface CampaignRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  create: (tenantId: string, input: NewSpringCampaign) => Promise<string>;
  start: (tenantId: string, campaignId: string) => Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class BadForm extends Error {}

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const ids = (form: FormData, name: string) =>
  form.getAll(name).filter((v): v is string => typeof v === "string" && UUID.test(v));
const whole = (value: string, fallback?: number) => {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new BadForm();
  return n;
};

/** The new campaign's fields, read the way a Swedish form writes them. */
export function campaignInput(form: FormData): NewSpringCampaign {
  const year = whole(text(form, "year"));
  const startDate = text(form, "startDate");
  const bookServiceTypeId = text(form, "bookService");
  if (!year || !DAY.test(startDate) || !UUID.test(bookServiceTypeId)) throw new BadForm();
  const discount = text(form, "discount").replace(",", ".");
  const batchSize = whole(text(form, "batchSize"));
  const defaultWeek = whole(text(form, "defaultWeek"));
  return {
    name: text(form, "name"),
    year,
    scheduledAt: stockholmInstant(startDate, "18:30"),
    springServiceIds: ids(form, "spring"),
    layUpServiceIds: ids(form, "layUp"),
    bookServiceTypeId,
    ...(batchSize ? { batchSize: Math.min(Math.max(batchSize, 1), 500) } : {}),
    ...(defaultWeek ? { defaultWeek } : {}),
    discountPercent: discount ? Number(discount) : null,
  };
}

export function createCampaignRoutes(deps: CampaignRouteDeps) {
  const back = (path: string, query: string) =>
    new Response(null, { status: 303, headers: { location: `${path}?${query}` } });

  async function guard(request: Request) {
    const session = await deps.session(request);
    if (session?.step !== "none") return { response: new Response(null, { status: 401 }) };
    if (session.role === "mechanic") return { session, forbidden: true as const };
    return { session };
  }

  const problemOf = (error: unknown) => {
    if (error instanceof BadForm) return "invalid_input";
    if (error instanceof CampaignError) return error.code;
    console.error("[kampanjer] action failed", safeError(error));
    return "failed";
  };

  return {
    async create(request: Request): Promise<Response> {
      const g = await guard(request);
      if ("response" in g) return g.response;
      if (g.forbidden) return back("/kampanjer", "fel=forbidden");
      try {
        const form = await request.formData().catch(() => {
          throw new BadForm();
        });
        const id = await deps.create(g.session.context.tenantId, campaignInput(form));
        return back(`/kampanjer/${id}`, "klart=skapad");
      } catch (error) {
        return back("/kampanjer", `fel=${problemOf(error)}`);
      }
    },

    async start(request: Request, campaignId: string): Promise<Response> {
      const g = await guard(request);
      if ("response" in g) return g.response;
      if (!UUID.test(campaignId)) return new Response(null, { status: 404 });
      if (g.forbidden) return back(`/kampanjer/${campaignId}`, "fel=forbidden");
      try {
        await deps.start(g.session.context.tenantId, campaignId);
        return back(`/kampanjer/${campaignId}`, "klart=startad");
      } catch (error) {
        return back(`/kampanjer/${campaignId}`, `fel=${problemOf(error)}`);
      }
    },
  };
}
