import { pipelineRoute } from "../../../../lib/server";

type Params = { params: Promise<{ id: string }> };

/** Moves a card on the pipeline (step 5.4). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return pipelineRoute(request, id);
}
