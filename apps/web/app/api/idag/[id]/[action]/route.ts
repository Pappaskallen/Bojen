import { codesRoute, dayRoute } from "../../../../../lib/server";

type Params = { params: Promise<{ id: string; action: string }> };

/** The forms on the mechanic's day view (step 5.5), and the codes for the phone (step 5.5c). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id, action } = await params;
  return action === "koder" ? codesRoute(request, id) : dayRoute(request, id, action);
}
