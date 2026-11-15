import { voiceToolsRoute } from "../../../../lib/server";

type Params = { params: Promise<{ tool: string }> };

/**
 * The receptionist's tools (step 6.1): `samtal` starts a call with the voice agent's own
 * secret; every other name is a tool, called with the call's token.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { tool } = await params;
  return tool === "samtal"
    ? voiceToolsRoute.startCall(request)
    : voiceToolsRoute.tool(request, tool);
}
