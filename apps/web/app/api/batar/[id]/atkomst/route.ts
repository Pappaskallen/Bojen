import { boatAccessRoute } from "../../../../../lib/server";

type Params = { params: Promise<{ id: string }> };

/** The access information from the boat card (step 5.2), after a confirmation. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return boatAccessRoute(request, id);
}
