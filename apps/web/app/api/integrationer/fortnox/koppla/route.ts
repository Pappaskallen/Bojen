import { fortnoxRoutes } from "../../../../../lib/server";

/** Sends the owner to Fortnox to connect (step 8). */
export function GET(request: Request): Promise<Response> {
  return fortnoxRoutes.connect(request);
}
