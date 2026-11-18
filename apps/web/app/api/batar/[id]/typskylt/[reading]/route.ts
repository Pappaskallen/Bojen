import { nameplateRoute } from "../../../../../../lib/server";

type Params = { params: Promise<{ id: string; reading: string }> };

/** Confirm or dismiss a type plate suggestion on the boat card (step 6.3). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id, reading } = await params;
  return nameplateRoute(request, id, reading);
}
