import { publicRoutes } from "../../../../../lib/server";

type Params = { params: Promise<{ tenant: string; action: string }> };

const POSTS = {
  code: publicRoutes.code,
  verify: publicRoutes.verify,
  suggestions: publicRoutes.suggestions,
  book: publicRoutes.book,
} as const;

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { tenant, action } = await params;
  const handler = Object.hasOwn(POSTS, action) ? POSTS[action as keyof typeof POSTS] : undefined;
  return handler
    ? handler(request, tenant)
    : Response.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { tenant, action } = await params;
  return action === "address"
    ? publicRoutes.address(request, tenant)
    : Response.json({ error: "not_found" }, { status: 404 });
}
