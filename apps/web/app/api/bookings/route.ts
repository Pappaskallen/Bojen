import { bookingRoutes } from "../../../lib/server";

export function POST(request: Request): Promise<Response> {
  return bookingRoutes.create(request);
}
