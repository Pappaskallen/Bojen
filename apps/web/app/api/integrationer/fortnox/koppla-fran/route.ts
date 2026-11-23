import { fortnoxRoutes } from "../../../../../lib/server";

/** Removes the Fortnox connection (step 8). */
export function POST(request: Request): Promise<Response> {
  return fortnoxRoutes.disconnect(request);
}
