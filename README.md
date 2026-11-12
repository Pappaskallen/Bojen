# Bojen

Bokning, CRM, automation och AI-receptionist för ambulerande båtmekaniker.
Arbetsnamn. Specifikationen ligger i `docs/`, byggplanen i `docs/byggplan.md`.

## Kom igång med Claude Code

1. Starta **Docker Desktop** och vänta på *Engine running* (behövs för lokal Supabase).
2. Öppna mappen `C:\Users\rober\Documents\Appar\Bojen` som en ny session i Claude Code.
3. Skriv:

   > Läs CLAUDE.md och docs/byggplan.md. Genomför steg 0. Visa planen först, implementera sedan och kör testerna.

4. När steget är klart och avbockat: ta nästa steg på samma sätt
   (”Genomför steg 1.1 …”). Ett steg per omgång, gärna en ny session per fas.

## Att göra parallellt (inte kod)

| Vad | Varför | Senast |
|---|---|---|
| Ansök om integrationspartnerskap hos Fortnox | Godkännandet tar tid; steg 8 | Nu |
| Värva 3–5 pilotfirmor i Stockholms skärgård | Testdata, feedback, pilot 1 mars | 20 nov |
| Konton: Supabase (eu-north-1), 46elks, Azure Speech (Sweden Central), Mailgun EU, Anthropic | Behövs från fas 2–6; tester klarar sig med fejkadaptrar | Före respektive fas |
| Röstprototyp i Vapi för pilotfirmorna | Testa manus och röst tidigt | December |

## Kommandon

Kör `corepack enable` en gång, sedan:

| Kommando | Gör |
|---|---|
| `pnpm install` | Installerar beroenden |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Kontrollerna som CI kör (plus `pnpm format:check`) |
| `pnpm format` | Formaterar koden med Prettier |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` | Lokal Supabase utan tjänster som inte behövs (Storage ingår från steg 2.5) |
| `pnpm e2e` | Playwright mot bokningssidan, widgeten, inloggningen för personal och Lighthouse. Kräver `pnpm db:start` (Auth, Storage och Mailpit). Bygger webbappen och **tömmer den lokala databasen** och fyller den med testdata |
| Mailpit, http://127.0.0.1:54324 | Här hamnar inloggningskoderna för personalen lokalt. Testpersonalen är `jonas@jonas-batservice.test`, `elin@jonas-batservice.test` och `kim@skargardsmekarna.test` |
| `pnpm db:generate` / `pnpm db:migrate` | Skapar en migrering från schemat / kör migreringarna |
| `pnpm db:seed` | Tömmer den lokala databasen och lägger in testdata (Jonas Båtservice). Vägrar köra mot annat än localhost |
| `pnpm --filter @bojen/web dev` | Next.js på http://localhost:3000 |

## Mappar

| Sökväg | Innehåll |
|---|---|
| `CLAUDE.md` | Regler för kodagenten |
| `docs/spec-del1.md` | Specifikation kap. 1–7 |
| `docs/spec-del2.md` | Specifikation kap. 8–16 |
| `docs/byggplan.md` | Stegen med statuslista |
| `docs/changelog.md` | Logg per avslutat steg |
| `apps/web` | Next.js 15: administration, bokningssida, API |
| `apps/worker` | Bakgrundsjobb (Graphile Worker från steg 3.1) |
| `packages/core` | Ren domänlogik och svenska texter (`src/i18n/sv.ts`) |
| `packages/adapters` | Externa tjänster med fejkimplementationer |
| `packages/db` | Drizzle-schema och migreringar |
| `supabase/` | Konfiguration för lokal Supabase |
