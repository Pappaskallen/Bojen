import { defineConfig } from "drizzle-kit";
import { localDatabaseUrl } from "./src/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? localDatabaseUrl },
});
