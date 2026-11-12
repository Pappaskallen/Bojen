/**
 * Webhooks from outside (byggplan step 3.1):
 *
 *   POST /api/webhooks/supabase/send-sms   Supabase Auth's sms hook: a staff sign-in code to
 *                                          send. Signed with Standard Webhooks.
 *   POST /api/webhooks/elks/delivery?token=…   46elks' delivery report for an sms we sent.
 *                                          46elks does not sign these, so the URL carries a
 *                                          secret token instead.
 *
 * The code in the sms hook is passed on to 46elks and nowhere else: not logged, not stored.
 */
import { parseElksDeliveryReport } from "@bojen/adapters";
import type { SmsSender } from "@bojen/core";
import { standardWebhookValid, tokenMatches } from "@bojen/core/crypto";
import { recordDelivery, sendCodeSms, staffByAuthUser, type Database } from "@bojen/db";

export interface WebhookDeps {
  db: () => Database;
  sms: () => SmsSender;
  now: () => Date;
  /** `SUPABASE_AUTH_SMS_HOOK_SECRET`, as `v1,whsec_<base64>`. */
  smsHookSecret: () => string | undefined;
  /** `ELKS_WEBHOOK_SECRET`, the token in the delivery URL. */
  elksToken: () => string | undefined;
}

interface SmsHookPayload {
  user?: { id?: unknown; phone?: unknown };
  sms?: { otp?: unknown };
}

/** The answer Supabase Auth expects from a hook that failed. */
const hookError = (status: number, message: string) =>
  Response.json({ error: { http_code: status, message } }, { status });

export function createWebhookRoutes(deps: WebhookDeps) {
  return {
    async supabaseSendSms(request: Request): Promise<Response> {
      const secret = deps.smsHookSecret();
      if (!secret) return hookError(500, "The sms hook is not configured");
      const body = await request.text();
      const valid = standardWebhookValid({
        secret,
        id: request.headers.get("webhook-id"),
        timestamp: request.headers.get("webhook-timestamp"),
        signature: request.headers.get("webhook-signature"),
        body,
        now: deps.now(),
      });
      if (!valid) return hookError(401, "Invalid signature");

      const payload = JSON.parse(body) as SmsHookPayload;
      const userId = payload.user?.id;
      const phone = payload.user?.phone;
      const code = payload.sms?.otp;
      if (typeof userId !== "string" || typeof phone !== "string" || typeof code !== "string") {
        return hookError(400, "Missing user, phone or code");
      }
      const staff = await staffByAuthUser(deps.db(), userId);
      if (!staff) return hookError(403, "Not staff");
      // Supabase Auth keeps numbers without the plus sign.
      const to = phone.startsWith("+") ? phone : `+${phone}`;
      try {
        await sendCodeSms(
          { db: deps.db(), now: deps.now, sms: deps.sms() },
          { tenantId: staff.tenantId, to },
          "staff_sign_in_code",
          { code },
        );
      } catch {
        return hookError(502, "The sms could not be sent");
      }
      return Response.json({});
    },

    async elksDelivery(request: Request): Promise<Response> {
      const expected = deps.elksToken();
      const given = new URL(request.url).searchParams.get("token");
      if (!expected || !tokenMatches(given, expected)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const form = new URLSearchParams(await request.text());
      const report = parseElksDeliveryReport(form);
      if (!report) return Response.json({ error: "invalid_input" }, { status: 400 });
      await recordDelivery(deps.db(), {
        externalId: report.id,
        status: report.status,
        deliveredAt: report.delivered,
      });
      // 46elks retries anything but 200, so an unknown id is still a 200.
      return new Response(null, { status: 200 });
    },
  };
}
