# Changelog

En rad per avslutat steg i byggplanen: datum, steg, vad som gjordes, eventuella avvikelser.

- 2026-11-07 – Projektet skapat: specifikation (del 1 och 2), byggplan och CLAUDE.md. Ingen kod än.
- 2026-11-07 – Steg 0: pnpm 12 + Turborepo med `apps/{web,worker}` och `packages/{core,adapters,db}`, TypeScript 6 strict, ESLint 9 (typescript-eslint, Next-regler), Prettier, Vitest 5, Next.js 15, Supabase CLI (`supabase/config.toml`, `pnpm db:start`), `.env.example` och CI (`.github/workflows/ci.yml`). Lint, typkontroll, tester och `next build` gröna lokalt. Avvikelser: TypeScript 6 i stället för 7 (typescript-eslint stöder <6.1) och ESLint 9 i stället för 10 (Next-pluginet). CI verifierad 2026-11-09 på GitHub (Pappaskallen/Bojen).
- 2026-11-08 – Steg 0, tillägg: `pnpm db:start` utesluter även storage-api (behövs från steg 2.5) och postgres-meta (bara för Studio). Lokal Supabase verifierad: Postgres 17 med PostGIS, pg_trgm, btree_gist och auth.jwt(), cirka 250 MB RAM.
