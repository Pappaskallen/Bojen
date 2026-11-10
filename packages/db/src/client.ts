import type { Logger } from "drizzle-orm/logger";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "./config";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbConnection {
  db: Database;
  close: () => Promise<void>;
}

export interface ConnectOptions {
  /** Receives every query and its parameters. Used by the test that looks for plaintext codes. */
  logger?: Logger;
}

/**
 * Opens a connection with the given URL. Locally that is the database owner,
 * which bypasses Row Level Security.
 */
export function connect(url: string = databaseUrl(), options: ConnectOptions = {}): DbConnection {
  const client = postgres(url, { max: 5, onnotice: () => undefined });
  return {
    db: drizzle(client, { schema, ...(options.logger ? { logger: options.logger } : {}) }),
    close: () => client.end(),
  };
}
