import { privacyRoutes } from "../../../../../lib/server";

type Context = { params: Promise<{ id: string }> };

/** The customer's personal data as JSON, for the owner and administrators (step 7.4). */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  return privacyRoutes.export(request, (await params).id);
}
