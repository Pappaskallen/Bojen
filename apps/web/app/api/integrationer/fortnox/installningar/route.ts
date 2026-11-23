import { fortnoxRoutes } from "../../../../../lib/server";

/** The firm's article numbers and due days for Fortnox (step 8). */
export function POST(request: Request): Promise<Response> {
  return fortnoxRoutes.settings(request);
}
