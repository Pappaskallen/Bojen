import { invoiceExportRoutes } from "../../../../lib/server";

/** Moves the month's exported jobs to Fakturerat (spec 12.1). */
export function POST(request: Request): Promise<Response> {
  return invoiceExportRoutes.markInvoiced(request);
}
