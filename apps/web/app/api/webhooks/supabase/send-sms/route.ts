import { webhookRoutes } from "../../../../../lib/server";

export const POST = (request: Request) => webhookRoutes.supabaseSendSms(request);
