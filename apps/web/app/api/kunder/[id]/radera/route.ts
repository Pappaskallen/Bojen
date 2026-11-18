import { privacyRoutes } from "../../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

/** Erases the customer, for the owner and administrators (step 7.4). */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  return privacyRoutes.erase(request, (await params).id);
}
