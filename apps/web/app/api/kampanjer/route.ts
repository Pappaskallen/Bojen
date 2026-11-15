import { campaignRoutes } from "../../../lib/server";

/** A new spring campaign, as a draft (step 5.6). */
export function POST(request: Request): Promise<Response> {
  return campaignRoutes.create(request);
}
