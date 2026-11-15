import { campaignRoutes } from "../../../../../lib/server";

type Params = { params: Promise<{ id: string }> };

/** Starts a campaign: the recipients are added and the first round is planned (step 5.6). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return campaignRoutes.start(request, id);
}
