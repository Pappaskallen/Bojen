/**
 * The customer's page behind the short link (byggplan step 3.4).
 *
 *   GET  /x/{code}                      the booking, new times, cancellation and access form
 *   POST /api/x/{code}/ombokning        slot=mechanicId|start   → 303 /x/{code}?klart=ombokad
 *   POST /api/x/{code}/avbokning                                → 303 /x/{code}?klart=avbokad
 *   POST /api/x/{code}/atkomst          code, keyLocation       → 303 /x/{code}?klart=atkomst
 *
 * Plain forms that post and redirect, so the page works without JavaScript. The code in the
 * address is the only key, so it is never logged, and the access fields are only written,
 * never read back.
 */
import type { MapsProvider } from "@bojen/core";
import type { Kms } from "@bojen/core/crypto";
import {
  BookingError,
  cancelByLink,
  managePage,
  publicSuggestions,
  rescheduleByLink,
  saveAccessByLink,
  type Database,
  type ManagePage,
  type PublicSuggestion,
} from "@bojen/db";

export interface CustomerPageDeps {
  db: () => Database;
  maps: () => MapsProvider;
  kms: () => Kms;
  now: () => Date;
  linkKey: () => string;
}

export type Done = "ombokad" | "avbokad" | "atkomst";
export type Problem = "missing" | "expired" | "used" | "closed" | "taken" | "invalid" | "failed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which message the page shows for a refused change. */
export function problemFor(error: unknown): Problem {
  if (!(error instanceof BookingError)) return "failed";
  switch (error.code) {
    case "link_used":
      return "used";
    case "link_expired":
      return "expired";
    case "not_found":
      return "missing";
    case "conflict":
      return "taken";
    case "invalid_input":
      return "invalid";
    case "too_late":
    case "invalid_transition":
    case "forbidden":
      return "closed";
    default:
      return "failed";
  }
}

/** A choice of new time, as the form sends it: `mechanicId|start`. */
export function parseSlot(value: unknown): { mechanicId: string; start: Date } | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const [mechanicId, iso] = value.split("|");
  if (!mechanicId || !UUID.test(mechanicId) || !iso) return null;
  const start = new Date(iso);
  return Number.isNaN(start.getTime()) ? null : { mechanicId, start };
}

export const slotValue = (s: Pick<PublicSuggestion, "mechanicId" | "start">) =>
  `${s.mechanicId}|${s.start}`;

export function createCustomerPage(deps: CustomerPageDeps) {
  const linkDeps = () => ({ db: deps.db(), now: deps.now, linkKey: deps.linkKey() });

  // A relative address, so the browser stays on the host it came from (see day-route.ts).
  const back = (_request: Request, code: string, query: string) =>
    new Response(null, {
      status: 303,
      headers: { location: `/x/${encodeURIComponent(code)}?${query}` },
    });

  async function form(request: Request): Promise<FormData | null> {
    return request.formData().catch(() => null);
  }

  async function act(request: Request, code: string, work: () => Promise<Done>) {
    try {
      return back(request, code, `klart=${await work()}`);
    } catch (error) {
      const problem = problemFor(error);
      if (problem === "failed") console.error("[customer-page] change failed", error);
      return back(request, code, `fel=${problem}`);
    }
  }

  return {
    /** The page, with up to three new times when the customer may still change. */
    async load(code: string): Promise<{ page: ManagePage; times: PublicSuggestion[] }> {
      const page = await managePage(linkDeps(), code);
      if (page.state !== "valid" || !page.mayChange || !page.suggest) return { page, times: [] };
      const times = await publicSuggestions(
        { db: deps.db(), maps: deps.maps(), now: deps.now },
        page.visit.tenantId,
        page.suggest,
      ).catch((error: unknown) => {
        console.error("[customer-page] no suggestions", error);
        return [];
      });
      return { page, times };
    },

    reschedule: async (request: Request, code: string) =>
      act(request, code, async () => {
        const slot = parseSlot((await form(request))?.get("slot"));
        if (!slot) throw new BookingError("invalid_input", "slot");
        await rescheduleByLink({ ...linkDeps(), db: deps.db() }, code, slot);
        return "ombokad";
      }),

    cancel: async (request: Request, code: string) =>
      act(request, code, async () => {
        await cancelByLink({ ...linkDeps(), db: deps.db() }, code);
        return "avbokad";
      }),

    access: async (request: Request, code: string) =>
      act(request, code, async () => {
        const data = await form(request);
        const field = (name: string) => {
          const v = data?.get(name);
          return typeof v === "string" ? v : undefined;
        };
        const accessCode = field("code");
        const keyLocation = field("keyLocation");
        await saveAccessByLink({ ...linkDeps(), kms: deps.kms() }, code, {
          ...(accessCode === undefined ? {} : { code: accessCode }),
          ...(keyLocation === undefined ? {} : { keyLocation }),
        });
        return "atkomst";
      }),
  };
}
