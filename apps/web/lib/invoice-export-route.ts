/**
 * The invoice bases as CSV, until Fortnox (spec 12.1): only the owner and administrators.
 *
 *   GET  /api/fakturaunderlag?manad=2027-03        → the month's approved bases as a CSV file
 *   POST /api/fakturaunderlag/fakturerat  manad=…  → 303 to /pipeline?fakturerat=N, or ?fakturafel=1
 */
import { invoiceCsv, type InvoiceExportRow } from "@bojen/core";
import { crm } from "@bojen/core/i18n/sv";
import type { StaffSession } from "./staff-auth";

export interface InvoiceExportRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  rows: (tenantId: string, month: string) => Promise<InvoiceExportRow[] | null>;
  markInvoiced: (tenantId: string, month: string) => Promise<number | null>;
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function createInvoiceExportRoutes(deps: InvoiceExportRouteDeps) {
  async function owner(request: Request) {
    const session = await deps.session(request);
    if (session?.step !== "none") return new Response(null, { status: 401, headers: NO_STORE });
    if (session.role === "mechanic") return new Response(null, { status: 403, headers: NO_STORE });
    return session;
  }

  return {
    async download(request: Request): Promise<Response> {
      const session = await owner(request);
      if (session instanceof Response) return session;
      const month = new URL(request.url).searchParams.get("manad") ?? "";
      const rows = await deps.rows(session.context.tenantId, month);
      if (!rows)
        return new Response(crm.invoiceExport.invalidMonth, { status: 400, headers: NO_STORE });
      return new Response(invoiceCsv(rows), {
        headers: {
          ...NO_STORE,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${crm.invoiceExport.fileName(month)}"`,
        },
      });
    },

    async markInvoiced(request: Request): Promise<Response> {
      const session = await owner(request);
      if (session instanceof Response) return session;
      const form = await request.formData().catch(() => null);
      const month = form?.get("manad");
      const moved =
        typeof month === "string" ? await deps.markInvoiced(session.context.tenantId, month) : null;
      const location =
        moved === null
          ? "/pipeline?fakturafel=1"
          : `/pipeline?fakturerat=${String(moved)}&manad=${String(month)}`;
      return new Response(null, { status: 303, headers: { location } });
    },
  };
}
