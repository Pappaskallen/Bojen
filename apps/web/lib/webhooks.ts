/**
 * Webhooks from outside (byggplan steps 3.1 and 3.2):
 *
 *   POST /api/webhooks/supabase/send-sms   Supabase Auth's sms hook: a staff sign-in code to
 *                                          send. Signed with Standard Webhooks.
 *   POST /api/webhooks/elks/delivery?token=…   46elks' delivery report for an sms we sent.
 *                                          46elks does not sign these, so the URL carries a
 *                                          secret token instead.
 *   POST /api/webhooks/elks/sms?token=…    An sms a customer sent to the firm's number.
 *
 * 46elks has no signatures (checked against their documentation 2026-11-12). Its own advice
 * is to allow only its IP addresses, so both 46elks routes need the token and, in
 * production, a request from one of 46elks' addresses.
 *
 * The code in the sms hook is passed on to 46elks and nowhere else: not logged, not stored.
 */
import { parseElksDeliveryReport } from "@bojen/adapters";
import type { ReplyClassifier, SmsSender } from "@bojen/core";
import { standardWebhookValid, tokenMatches } from "@bojen/core/crypto";
import { receiveSms, recordDelivery, sendCodeSms, staffByAuthUser, type Database } from "@bojen/db";

export interface WebhookDeps {
  db: () => Database;
  sms: () => SmsSender;
  now: () => Date;
  /** `SUPABASE_AUTH_SMS_HOOK_SECRET`, as `v1,whsec_<base64>`. */
  smsHookSecret: () => string | undefined;
  /** `ELKS_WEBHOOK_SECRET`, the token in the 46elks webhook URLs. */
  elksToken: () => string | undefined;
  /** The addresses 46elks calls from; null means no check (development and tests). */
  elksIps: () => readonly string[] | null;
  /** Reads free-text replies (step 3.2). */
  classifier: () => ReplyClassifier;
  /** `SMS_OPT_OUT_KEY`, for STOPP. */
  optOutKey: () => string;
}

/** 46elks' API and webhook servers, from https://46elks.com/docs/ip-addresses (2026-11-12). */
export const ELKS_IPS = [
  "176.10.154.199",
  "85.24.146.132",
  "185.39.146.243",
  "2001:9b0:2:902::199",
] as const;

/**
 * The caller's address as the host reports it. On Vercel `x-real-ip` and the first
 * `x-forwarded-for` entry are set by the platform, not by the caller.
 */
function callerIp(request: Request): string | null {
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

interface SmsHookPayload {
  user?: { id?: unknown; phone?: unknown };
  sms?: { otp?: unknown };
}

/** The answer Supabase Auth expects from a hook that failed. */
const hookError = (status: number, message: string) =>
  Response.json({ error: { http_code: status, message } }, { status });

export function createWebhookRoutes(deps: WebhookDeps) {
  /** Null when the request may go on: the right token, and from 46elks where that is checked. */
  function fromElks(request: Request): Response | null {
    const expected = deps.elksToken();
    const given = new URL(request.url).searchParams.get("token");
    if (!expected || !tokenMatches(given, expected)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const allowed = deps.elksIps();
    if (allowed) {
      const ip = callerIp(request);
      if (!ip || !allowed.includes(ip))
        return Response.json({ error: "forbidden" }, { status: 403 });
    }
    return null;
  }

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
      const refused = fromElks(request);
      if (refused) return refused;
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

    async elksSms(request: Request): Promise<Response> {
      const refused = fromElks(request);
      if (refused) return refused;
      const form = new URLSearchParams(await request.text());
      const id = form.get("id");
      const from = form.get("from");
      const to = form.get("to");
      const body = form.get("message");
      if (!id || !from || !to || body === null) {
        return Response.json({ error: "invalid_input" }, { status: 400 });
      }
      await receiveSms(
        {
          db: deps.db(),
          now: deps.now,
          optOutKey: deps.optOutKey(),
          classifier: deps.classifier(),
        },
        { externalId: id, from, to, body },
      );
      // No body: 46elks would send any text in the answer to the customer as an sms.
      return new Response(null, { status: 204 });
    },
  };
}
