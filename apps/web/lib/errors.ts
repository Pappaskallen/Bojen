import { errorReporterFromEnv } from "@bojen/adapters/errors";
import { safeError, type ErrorReporter } from "@bojen/core/logging";

/**
 * Errors from the web app to GlitchTip (byggplan step 9), when `GLITCHTIP_DSN` is set. What is
 * sent is made safe like the log (`errorEvent` in core): no request, no user, no values.
 */
let reporter: ErrorReporter | undefined;

export function errorReporter(): ErrorReporter {
  reporter ??= errorReporterFromEnv("web");
  return reporter;
}

/** A failure a route handles itself: logged as before, and reported with where it was. */
export function logError(where: string, error: unknown): void {
  console.error(where, safeError(error));
  void errorReporter().report(error, { tags: { where } });
}

/**
 * A failure whose message may hold what a caller said (the voice tools) or a type plate's
 * text: only the error's kind is logged, and only its kind and stack frames are reported.
 */
export function logErrorKind(where: string, error: unknown): void {
  const e = typeof error === "object" && error !== null ? (error as Error) : null;
  const kind = { name: typeof e?.name === "string" ? e.name : "Error", stack: e?.stack };
  console.error(where, kind.name);
  void errorReporter().report(kind, { tags: { where } });
}

/** The part of Next.js's `onRequestError` context that is kept: the route's pattern, never its path. */
export interface RequestErrorContext {
  routerKind: string;
  routePath: string;
  routeType: string;
}

/**
 * An error no route caught (Next.js's `onRequestError` in instrumentation.ts). The route is
 * reported as its pattern, `/kunder/[id]`, so no customer id or link code goes along.
 */
export function reportRequestError(
  to: ErrorReporter,
  error: unknown,
  request: { method: string },
  context: RequestErrorContext,
): Promise<void> {
  return to.report(error, {
    tags: { route: context.routePath, routeType: context.routeType, method: request.method },
  });
}
