import { tasksRoute } from "../../../lib/server";

/** This phone takes web push for the signed-in staff member, or stops (step 6.4). */
export const POST = (request: Request) => tasksRoute.push(request);
export const DELETE = (request: Request) => tasksRoute.push(request);
