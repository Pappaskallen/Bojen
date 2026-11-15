import { passkeyRoutes } from "../../../../../lib/server";

type Params = { params: Promise<{ flow: string; part: string }> };

const ROUTES: Record<string, (request: Request) => Promise<Response>> = {
  "registrera/start": passkeyRoutes.registerStart,
  "registrera/klar": passkeyRoutes.registerFinish,
  "logga-in/start": passkeyRoutes.loginStart,
  "logga-in/klar": passkeyRoutes.loginFinish,
};

/** Passkeys for staff (step 5.5c). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { flow, part } = await params;
  const route = ROUTES[`${flow}/${part}`];
  return route ? route(request) : Response.json({ error: "not_found" }, { status: 404 });
}
