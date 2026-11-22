import { safeError, scrubMessage } from "./safeError";

/**
 * An error report for GlitchTip (byggplan step 9), in the event format of Sentry's store API,
 * which GlitchTip takes. Built from what may be logged and nothing else (spec 10, ASVS V7.1):
 * the error's kind and its scrubbed message from `safeError`, the stack's function names,
 * files and lines, and a few tags the caller names. No request, no headers, no cookies, no
 * user, no local variables, no source lines, so no customer data can ride along.
 */

export interface StackFrame {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

export interface ErrorEvent {
  event_id: string;
  /** Seconds since 1970, as Sentry's format wants. */
  timestamp: number;
  platform: "node";
  level: "error" | "fatal";
  logger: string;
  release?: string;
  environment: string;
  tags: Record<string, string>;
  exception: {
    values: { type: string; value: string; stacktrace?: { frames: StackFrame[] } }[];
  };
}

export interface ErrorEventOptions {
  /** `web` or `worker`, the event's logger and a tag. */
  service: string;
  environment: string;
  release?: string;
  /** For example the route `/kunder/[id]` or the task `send_message`; scrubbed and cut. */
  tags?: Record<string, string | undefined>;
  level?: "error" | "fatal";
  now: Date;
  /** 32 hex characters. */
  eventId: string;
}

const MAX_FRAMES = 50;
const TAG_LENGTH = 200;

/** One V8 stack line, `at fn (file:line:col)` or `at file:line:col`. */
const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

/** The stack's frames, oldest call first as Sentry wants; the first line (the message) is not used. */
export function stackFrames(stack: unknown): StackFrame[] {
  if (typeof stack !== "string") return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const [, fn, file = "", lineNo, colNo] = match;
    const filename = file.replace(/^file:\/\//, "").replace(/[?#].*$/, "");
    frames.push({
      ...(fn ? { function: fn.replace(/^async /, "") } : {}),
      filename,
      lineno: Number(lineNo),
      colno: Number(colNo),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return frames.slice(0, MAX_FRAMES).reverse();
}

/** `TypeError: visit not found` → type `TypeError`, value `visit not found`. */
function typeAndValue(error: unknown): { type: string; value: string } {
  const line = safeError(error);
  const colon = line.indexOf(": ");
  return colon > 0
    ? { type: line.slice(0, colon), value: line.slice(colon + 2) }
    : { type: line, value: "" };
}

export function errorEvent(error: unknown, options: ErrorEventOptions): ErrorEvent {
  const tags: Record<string, string> = { service: options.service };
  for (const [key, value] of Object.entries(options.tags ?? {})) {
    if (value) tags[key] = scrubMessage(value).slice(0, TAG_LENGTH);
  }
  const frames =
    typeof error === "object" && error !== null
      ? stackFrames((error as { stack?: unknown }).stack)
      : [];
  return {
    event_id: options.eventId,
    timestamp: options.now.getTime() / 1000,
    platform: "node",
    level: options.level ?? "error",
    logger: options.service,
    ...(options.release ? { release: options.release } : {}),
    environment: options.environment,
    tags,
    exception: {
      values: [{ ...typeAndValue(error), ...(frames.length ? { stacktrace: { frames } } : {}) }],
    },
  };
}

/** What the reporter sends errors to: GlitchTip in production, a fake in tests. */
export interface ErrorReporter {
  /** Never throws and never waits long; a report that cannot be sent is dropped. */
  report(
    error: unknown,
    context?: { tags?: Record<string, string | undefined>; level?: "error" | "fatal" },
  ): Promise<void>;
}
