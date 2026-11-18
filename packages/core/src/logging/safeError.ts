/**
 * What may be logged about an error (spec 10, ASVS V7.1). Drizzle puts the query's parameters
 * in its error message, and those are names, phone numbers and texts to customers; Graphile
 * Worker both logs a failed job's message and stores it in `last_error`. So an error is
 * logged as its kind and, for a database error, the Postgres code and constraint, never the
 * parameters or the row it was about.
 */

const MAX_LENGTH = 200;

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
  query?: unknown;
  cause?: unknown;
}

const asRecord = (value: unknown): ErrorLike | null =>
  typeof value === "object" && value !== null ? (value as ErrorLike) : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Phone numbers, e-mail addresses and long digit runs (codes) out of a free-text message. */
export function scrubMessage(message: string): string {
  const scrubbed = message
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-post]")
    .replace(/\+?\d[\d\s-]{4,}\d/g, "[nummer]");
  return scrubbed.length > MAX_LENGTH ? `${scrubbed.slice(0, MAX_LENGTH)}…` : scrubbed;
}

/** The SQL verb and table, e.g. `insert into "message"`: never the values. */
function queryShape(query: string): string {
  const match = /^\s*(select|insert into|update|delete from|with)\s+("?[\w.]+"?)?/i.exec(query);
  return match ? `${match[1]?.toLowerCase() ?? ""} ${match[2] ?? ""}`.trim() : "query";
}

/** A one-line description of an error that is safe to log and to store. */
export function safeError(error: unknown): string {
  const e = asRecord(error);
  if (!e) return typeof error === "string" ? scrubMessage(error) : "unknown error";
  const name = text(e.name) ?? "Error";

  const query = text(e.query);
  if (query !== null) {
    // A failed database query: the Postgres error is the cause.
    const cause = asRecord(e.cause);
    const code = text(cause?.code);
    const constraint = text(cause?.constraint_name) ?? text(cause?.constraint);
    const details = [code && `pg ${code}`, constraint && `constraint ${constraint}`].filter(
      Boolean,
    );
    return `${name}: ${queryShape(query)}${details.length ? ` (${details.join(", ")})` : ""}`;
  }

  const code = text(e.code);
  if (code !== null && /^[0-9A-Z]{5}$/.test(code)) {
    // A Postgres error on its own: its message can quote a value.
    const constraint = text(e.constraint_name) ?? text(e.constraint);
    return `${name}: pg ${code}${constraint ? `, constraint ${constraint}` : ""}`;
  }

  const message = text(e.message);
  return message ? `${name}: ${scrubMessage(message)}` : name;
}
