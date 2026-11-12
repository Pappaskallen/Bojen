import { customerPage } from "../../../../../lib/server";

type Params = { params: Promise<{ code: string; action: string }> };

const POSTS = {
  ombokning: customerPage.reschedule,
  avbokning: customerPage.cancel,
  atkomst: customerPage.access,
} as const;

/** The forms on the customer's page, `/x/{code}` (step 3.4). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { code, action } = await params;
  const handler = Object.hasOwn(POSTS, action) ? POSTS[action as keyof typeof POSTS] : undefined;
  return handler ? handler(request, code) : Response.json({ error: "not_found" }, { status: 404 });
}
