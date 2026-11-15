import { boatPictureRoute, codesRoute, dayRoute, reportRoute } from "../../../../../lib/server";

type Params = { params: Promise<{ id: string; action: string }> };

/**
 * The forms on the mechanic's day view (step 5.5), the codes for the phone (step 5.5c) and
 * the service report (step 5.5d).
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id, action } = await params;
  if (action === "koder") return codesRoute(request, id);
  if (action === "rapport") return reportRoute(request, id);
  return dayRoute(request, id, action);
}

/** The picture of the visit's boat (step 5.5d); nothing else here is read with GET. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id, action } = await params;
  if (action === "batbild") return boatPictureRoute(request, id);
  return new Response(null, { status: 404 });
}
