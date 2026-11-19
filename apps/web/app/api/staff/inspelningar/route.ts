import { privacyRoutes } from "../../../../lib/server";

/** The firm's choice of how long call audio is kept, for owners and administrators. */
export async function POST(request: Request): Promise<Response> {
  return privacyRoutes.audioDays(request);
}
