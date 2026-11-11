import { runMigrations } from "@bojen/db/migrate";

/** The booking tests use the local database; bring it to the latest migration. */
export default async function setup(): Promise<void> {
  await runMigrations();
}
