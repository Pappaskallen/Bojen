import { voiceToolsRoute } from "../../../../lib/server";

type Params = { params: Promise<{ tool: string }> };

/**
 * The receptionist's tools (steps 6.1 and 6.3): `samtal` starts a call and `transkript`
 * hands in its transcript afterwards, both with the voice agent's own secret; every other
 * name is a tool, called with the call's token.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { tool } = await params;
  if (tool === "samtal") return voiceToolsRoute.startCall(request);
  if (tool === "transkript") return voiceToolsRoute.transcript(request);
  return voiceToolsRoute.tool(request, tool);
}
