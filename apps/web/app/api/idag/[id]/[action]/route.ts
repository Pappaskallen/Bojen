import { dayRoute } from "../../../../../lib/server";

type Params = { params: Promise<{ id: string; action: string }> };

/** The forms on the mechanic's day view (step 5.5). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id, action } = await params;
  return dayRoute(request, id, action);
}
