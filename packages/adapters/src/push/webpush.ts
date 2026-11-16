import type { PushPayload, PushSender, PushTarget } from "@bojen/core";
import webpush from "web-push";

export interface WebPushOptions {
  /** VAPID keys, made once with `npx web-push generate-vapid-keys`. */
  publicKey: string;
  privateKey: string;
  /** Who runs the server, for the push services: `mailto:…` or the app's address. */
  subject: string;
}

/**
 * Web push with VAPID (byggplan step 6.4). The push services (Google's, Apple's, Mozilla's)
 * only see the encrypted payload. A push lives for 30 minutes at most: an alert older than
 * that is better missed than shown late.
 */
export function createWebPush(options: WebPushOptions): PushSender {
  const vapidDetails = {
    subject: options.subject,
    publicKey: options.publicKey,
    privateKey: options.privateKey,
  };
  return {
    async send(target: PushTarget, payload: PushPayload) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          {
            vapidDetails,
            TTL: 30 * 60,
            urgency: payload.urgent ? "high" : "normal",
            timeout: 10_000,
          },
        );
        return { gone: false };
      } catch (error) {
        // 404 and 410: the browser has dropped the subscription.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return { gone: true };
        throw error;
      }
    },
  };
}

/** The keys from the environment, or null when push is not set up. */
export function webPushFromEnv(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return createWebPush({ publicKey, privateKey, subject });
}
