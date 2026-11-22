import { invoiceExportRoutes } from "../../../lib/server";

/** The month's approved invoice bases as CSV (spec 12.1). */
export function GET(request: Request): Promise<Response> {
  return invoiceExportRoutes.download(request);
}
