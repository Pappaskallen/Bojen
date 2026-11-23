import { fortnoxRoutes } from "../../../../../lib/server";

/** Back from Fortnox: stores the connection (step 8). */
export function GET(request: Request): Promise<Response> {
  return fortnoxRoutes.callback(request);
}
