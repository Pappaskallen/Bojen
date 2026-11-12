import { staffAdminRoutes } from "../../../../../lib/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
): Promise<Response> {
  const { id, action } = await params;
  if (action === "revoke") return staffAdminRoutes.revoke(request, id);
  if (action === "reset-factor") return staffAdminRoutes.resetFactor(request, id);
  return Response.json({ error: "not_found" }, { status: 404 });
}
