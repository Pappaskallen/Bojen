import type { SmsSender } from "@bojen/core";
import { createElksSms } from "./elks";

/**
 * 46elks from the environment, shared by the web app and the worker; null when it is not
 * configured (then the caller decides whether a fake is allowed).
 *
 * - `ELKS_API_USERNAME`, `ELKS_API_PASSWORD`: the API credentials.
 * - `ELKS_FROM`: default sender, a number or at most 11 letters (default `Bojen`).
 * - `ELKS_WEBHOOK_SECRET` and `APP_URL`: where delivery reports go, with the secret token.
 * - `ELKS_API_URL`: another API server (the end-to-end tests run a fake one).
 * - `ELKS_DRY_RUN=1`: 46elks checks each request but sends nothing.
 */
export function elksFromEnv(env: NodeJS.ProcessEnv = process.env): SmsSender | null {
  const username = env.ELKS_API_USERNAME;
  const password = env.ELKS_API_PASSWORD;
  if (!username || !password) return null;
  const secret = env.ELKS_WEBHOOK_SECRET;
  const app = env.APP_URL?.replace(/\/+$/, "");
  return createElksSms({
    username,
    password,
    from: env.ELKS_FROM ?? "Bojen",
    ...(secret && app
      ? { deliveryUrl: `${app}/api/webhooks/elks/delivery?token=${encodeURIComponent(secret)}` }
      : {}),
    ...(env.ELKS_API_URL ? { baseUrl: env.ELKS_API_URL } : {}),
    dryRun: env.ELKS_DRY_RUN === "1",
  });
}
