import postgres from "postgres";
import { databaseUrl } from "../src/config";
import { runMigrations } from "../src/migrate";

/** Checks that the local database is up and brings it to the latest migration. */
export default async function setup(): Promise<void> {
  const url = databaseUrl();
  const client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await client`select 1`;
  } catch (error) {
    throw new Error(
      `Database tests need a running Postgres at ${url}. Start local Supabase with \`pnpm db:start\`.`,
      { cause: error },
    );
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
