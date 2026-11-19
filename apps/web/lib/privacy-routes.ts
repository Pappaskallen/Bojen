/**
 * Export and erasure of a customer's personal data (byggplan step 7.4, spec 10.3 and 10.6):
 * only the owner and administrators.
 *
 *   GET  /api/kunder/{id}/export   → the customer's data as a JSON file
 *   GET  /api/kunder/{id}/export?format=pdf → the same as a document to read
 *   POST /api/kunder/{id}/radera   confirm=RADERA → 303 to /kunder?raderad=1, or back with fel=…
 *   POST /api/staff/inspelningar   days=30|90 → 303 to /sakerhet?ljud=30, or ?ljudfel=…
 */
import { crm } from "@bojen/core/i18n/sv";
import { safeError } from "@bojen/core/logging";
import { AUDIO_DAY_CHOICES, exportDocument, type CustomerExportData } from "@bojen/core/privacy";
import { exportPdf } from "./export-pdf";
import type { StaffSession } from "./staff-auth";

export interface PrivacyRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  exportCustomer: (
    tenantId: string,
    customerId: string,
    actorId: string,
  ) => Promise<CustomerExportData | null>;
  erase: (tenantId: string, customerId: string, actorId: string) => Promise<boolean>;
  setAudioDays: (tenantId: string, days: number, actorId: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function createPrivacyRoutes(deps: PrivacyRouteDeps) {
  const back = (location: string) => new Response(null, { status: 303, headers: { location } });

  async function guard(request: Request, customerId: string) {
    if (!UUID.test(customerId)) return { response: new Response(null, { status: 404 }) };
    const session = await deps.session(request);
    if (session?.step !== "none") return { response: new Response(null, { status: 401 }) };
    if (session.role === "mechanic") return { session, forbidden: true as const };
    return { session };
  }

  return {
    async export(request: Request, customerId: string): Promise<Response> {
      const g = await guard(request, customerId);
      if ("response" in g) return g.response;
      if (g.forbidden) return new Response(null, { status: 403, headers: NO_STORE });
      const { tenantId, actor } = g.session.context;
      const data = await deps.exportCustomer(tenantId, customerId, actor.id);
      if (!data) return new Response(null, { status: 404, headers: NO_STORE });
      if (new URL(request.url).searchParams.get("format") === "pdf") {
        const pdf = await exportPdf(exportDocument(data), new Date(data.exportedAt));
        return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
          headers: {
            ...NO_STORE,
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="kund-${customerId}.pdf"`,
          },
        });
      }
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          ...NO_STORE,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="kund-${customerId}.json"`,
        },
      });
    },

    async erase(request: Request, customerId: string): Promise<Response> {
      const g = await guard(request, customerId);
      if ("response" in g) return g.response;
      const card = `/kunder/${customerId}`;
      if (g.forbidden) return back(`${card}?fel=forbidden`);
      const form = await request.formData().catch(() => null);
      const confirm = form?.get("confirm");
      if (typeof confirm !== "string" || confirm.trim().toUpperCase() !== crm.privacy.confirmWord) {
        return back(`${card}?fel=confirm`);
      }
      try {
        const { tenantId, actor } = g.session.context;
        if (!(await deps.erase(tenantId, customerId, actor.id))) {
          return new Response(null, { status: 404 });
        }
        return back("/kunder?raderad=1");
      } catch (error) {
        console.error("[radera] erasure failed", safeError(error));
        return back(`${card}?fel=failed`);
      }
    },

    /** The firm's choice of how long call audio is kept (spec 10.5). */
    async audioDays(request: Request): Promise<Response> {
      const session = await deps.session(request);
      if (session?.step !== "none") return new Response(null, { status: 401 });
      if (session.role === "mechanic") return back("/sakerhet?ljudfel=forbidden");
      const form = await request.formData().catch(() => null);
      const days = Number(form?.get("days"));
      if (!AUDIO_DAY_CHOICES.includes(days as 30 | 90)) return back("/sakerhet?ljudfel=failed");
      try {
        const { tenantId, actor } = session.context;
        await deps.setAudioDays(tenantId, days, actor.id);
        return back(`/sakerhet?ljud=${String(days)}#ljud`);
      } catch (error) {
        console.error("[inspelningar] saving failed", safeError(error));
        return back("/sakerhet?ljudfel=failed");
      }
    },
  };
}
