/**
 * Export and erasure of a customer's personal data (byggplan step 7.4, spec 10.3 and 10.6):
 * only the owner and administrators.
 *
 *   GET  /api/kunder/{id}/export   → the customer's data as a JSON file
 *   POST /api/kunder/{id}/radera   confirm=RADERA → 303 to /kunder?raderad=1, or back with fel=…
 */
import { crm } from "@bojen/core/i18n/sv";
import { safeError } from "@bojen/core/logging";
import type { StaffSession } from "./staff-auth";

export interface PrivacyRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  exportCustomer: (tenantId: string, customerId: string, actorId: string) => Promise<unknown>;
  erase: (tenantId: string, customerId: string, actorId: string) => Promise<boolean>;
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
  };
}
