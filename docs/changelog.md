# Changelog

En rad per avslutat steg i byggplanen: datum, steg, vad som gjordes, eventuella avvikelser.

- 2026-11-07 – Projektet skapat: specifikation (del 1 och 2), byggplan och CLAUDE.md. Ingen kod än.
- 2026-11-07 – Steg 0: pnpm 12 + Turborepo med `apps/{web,worker}` och `packages/{core,adapters,db}`, TypeScript 6 strict, ESLint 9 (typescript-eslint, Next-regler), Prettier, Vitest 5, Next.js 15, Supabase CLI (`supabase/config.toml`, `pnpm db:start`), `.env.example` och CI (`.github/workflows/ci.yml`). Lint, typkontroll, tester och `next build` gröna lokalt. Avvikelser: TypeScript 6 i stället för 7 (typescript-eslint stöder <6.1) och ESLint 9 i stället för 10 (Next-pluginet). Ej verifierat: `pnpm db:start` (C: full, Docker kraschade under nedladdning av images) och CI (repot har ingen GitHub-remote).
