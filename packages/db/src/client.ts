import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "./config";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbConnection {
  db: Database;
  close: () => Promise<void>;
}

/**
 * Opens a connection with the given URL. Locally that is the database owner,
 * which bypasses Row Level Security.
 */
export function connect(url: string = databaseUrl()): DbConnection {
  const client = postgres(url, { max: 5, onnotice: () => undefined });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}
