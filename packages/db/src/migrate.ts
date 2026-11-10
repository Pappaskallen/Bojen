import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "./client";
import { databaseUrl } from "./config";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies all pending migrations in packages/db/migrations. */
export async function runMigrations(url: string = databaseUrl()): Promise<void> {
  const { db, close } = connect(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => console.info("[db] migrations applied"))
    .catch((error: unknown) => {
      console.error("[db] migration failed", error);
      process.exitCode = 1;
    });
}
