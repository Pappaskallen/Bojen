import { connect, type DbConnection } from "@bojen/db";
import { createBookingRoutes, type RequestContext } from "./bookings";

let connection: DbConnection | undefined;

/** One connection pool per server process, opened on first use. */
function db() {
  connection ??= connect();
  return connection.db;
}

/**
 * Sign-in does not exist yet. Staff sign in with Supabase Auth and customers act through
 * the links in their sms (steps 2.5 and 3.4); until then every request is refused with 401,
 * so the routes cannot be used without a proven tenant and actor.
 */
function authorize(): Promise<RequestContext | null> {
  return Promise.resolve(null);
}

export const bookingRoutes = createBookingRoutes({ db, now: () => new Date(), authorize });
