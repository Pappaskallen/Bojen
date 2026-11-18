import { tasksRoute } from "../../../../lib/server";

type Params = { params: Promise<{ id: string }> };

/** "Jag tar det" or "Klart" on a message from the receptionist (step 6.4). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return tasksRoute.decide(request, id);
}
