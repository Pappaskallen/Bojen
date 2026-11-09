/** Connection string for the local Supabase started with `pnpm db:start`. */
export const localDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL ?? localDatabaseUrl;
}
