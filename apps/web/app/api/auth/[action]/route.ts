import { staffAuthRoutes } from "../../../../lib/server";

const ACTIONS = {
  code: staffAuthRoutes.code,
  verify: staffAuthRoutes.verify,
  logout: staffAuthRoutes.logout,
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await params;
  const handler = Object.hasOwn(ACTIONS, action)
    ? ACTIONS[action as keyof typeof ACTIONS]
    : undefined;
  return handler ? handler(request) : Response.json({ error: "not_found" }, { status: 404 });
}
