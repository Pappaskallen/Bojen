import { errorEvent, type ErrorEvent, type ErrorReporter } from "@bojen/core/logging";

export interface GlitchTipOptions {
  /** The project's DSN from GlitchTip, `https://<key>@fel.bojen.app/<project>`. */
  dsn: string;
  /** `web` or `worker`. */
  service: string;
  environment: string;
  /** The deployed commit, so an error points at the code that ran. */
  release?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** The same error is sent at most once in this time (a job that fails on every retry). */
  repeatAfterMs?: number;
}

/** The store address and key from a DSN; throws on one that is not a DSN. */
export function parseDsn(dsn: string): { storeUrl: string; key: string } {
  const url = new URL(dsn);
  const project = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!url.username || !/^\d+$/.test(project)) {
    throw new Error("GLITCHTIP_DSN is not a DSN (https://<key>@<host>/<project>)");
  }
  return { storeUrl: `${url.origin}/api/${project}/store/`, key: url.username };
}

/**
 * Errors to our own GlitchTip (byggplan step 9) through Sentry's store API, which GlitchTip
 * takes. The event holds only what `errorEvent` lets through. A report that fails or is slow
 * is dropped, so reporting can never make the app fail or wait.
 */
export function createGlitchTipReporter(options: GlitchTipOptions): ErrorReporter {
  const { storeUrl, key } = parseDsn(options.dsn);
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const repeatAfter = options.repeatAfterMs ?? 60_000;
  const lastSent = new Map<string, number>();

  const fingerprint = (event: ErrorEvent) => {
    const [first] = event.exception.values;
    const frame = first?.stacktrace?.frames.at(-1);
    return [first?.type, first?.value, frame?.filename, frame?.lineno, event.tags.task].join("|");
  };

  return {
    async report(error, context = {}) {
      const at = now();
      const event = errorEvent(error, {
        service: options.service,
        environment: options.environment,
        ...(options.release ? { release: options.release } : {}),
        ...(context.tags ? { tags: context.tags } : {}),
        ...(context.level ? { level: context.level } : {}),
        now: at,
        eventId: globalThis.crypto.randomUUID().replaceAll("-", ""),
      });
      const print = fingerprint(event);
      const previous = lastSent.get(print);
      if (previous !== undefined && at.getTime() - previous < repeatAfter) return;
      lastSent.set(print, at.getTime());
      if (lastSent.size > 500) lastSent.clear();

      try {
        const response = await send(storeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=bojen/1.0, sentry_key=${key}`,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
        });
        if (!response.ok) {
          console.warn(`[errors] GlitchTip answered ${String(response.status)}`);
        }
      } catch {
        console.warn("[errors] GlitchTip could not be reached");
      }
    },
  };
}

/** A reporter that sends nothing, where no DSN is set (development, tests). */
export const noErrorReporter: ErrorReporter = { report: () => Promise.resolve() };

/**
 * GlitchTip when `GLITCHTIP_DSN` is set, otherwise the reporter that sends nothing: errors
 * are still in the log, so a missing DSN is not a reason to stop the app.
 */
export function errorReporterFromEnv(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): ErrorReporter {
  const dsn = env.GLITCHTIP_DSN;
  if (!dsn) return noErrorReporter;
  return createGlitchTipReporter({
    dsn,
    service,
    environment:
      env.APP_ENVIRONMENT ?? (env.NODE_ENV === "production" ? "production" : "development"),
    ...(env.APP_RELEASE ? { release: env.APP_RELEASE } : {}),
  });
}
