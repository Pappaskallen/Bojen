# Bojen – instruktioner för kodagenten

Bojen är ett allt-i-ett-system (bokning, CRM, automation och AI-receptionist) för
ambulerande båtmekaniker i Sverige, med start i Stockholms skärgård.

## Var saker står

- `docs/spec-del1.md` – kapitel 1–7: sammanfattning, antaganden, användarresor,
  funktionell spec, arkitektur, datamodell, automationsflöden F1–F15 med färdiga sms-texter.
- `docs/spec-del2.md` – kapitel 8–16: receptionisten (systemprompt i 8.2), KPI:er,
  GDPR och säkerhet, integrationer, etapper, affärsmodell, risker, konkurrenter, byggplan.
- `docs/byggplan.md` – **stegen du följer**, med statuslista och MVP-stacken.
- `docs/changelog.md` – en kort rad per avslutat steg.

Läs relevant kapitel i specifikationen innan du börjar ett steg. Om specifikationen och
byggplanen säger olika saker om teknik gäller byggplanens MVP-stack.

## Arbetssätt

- Genomför **ett steg i taget** enligt `docs/byggplan.md`. Visa en kort plan först.
- Gå inte vidare förrän stegets *Klart när* är uppfyllt och
  `pnpm lint && pnpm typecheck && pnpm test` passerar.
- Bocka av steget i statuslistan och skriv en rad i `docs/changelog.md`.
- Om något i ett steg inte går att göra som det står (konto saknas, val som inte håller):
  stanna och säg det. Gissa inte och byt inte teknik tyst.
- Fråga användaren innan du skapar konton, lägger in riktiga API-nycklar, skickar riktiga
  sms eller e-post, eller gör något som kostar pengar.

## Kodregler

- All domänlogik ligger i `packages/core`, är ren (ingen I/O) och enhetstestad.
- Externa tjänster anropas bara via `packages/adapters`. Tester använder fejkadaptrar.
  Riktiga anrop sker aldrig i tester.
- Varje tabell har `tenant_id` och Row Level Security. En ny tabell kräver ett isoleringstest.
- Koder och åtkomstinformation krypteras alltid med `packages/core/crypto` och loggas aldrig.
  Inget verktyg för röstagenten får returnera koder eller adresser.
- Kod och identifierare på engelska. Texter som visas för användare på svenska i
  `packages/core/i18n/sv.ts`.
- Telefonnummer sparas i E.164. Tider sparas som UTC och visas i Europe/Stockholm.
- Claude-modeller: `claude-haiku-5-5` i realtid (röstagenten, effort `low`),
  `claude-sonnet-5-5` för rapporter, typskyltar och svårtolkade sms. Använd det officiella
  SDK:t `@anthropic-ai/sdk`. Läs `claude-api`-skillen innan du skriver Claude-kod.
- Hemligheter ligger i `.env.local` (git-ignorerad). Uppdatera `.env.example` med
  variabelnamn, aldrig värden.

## Miljö

- Windows 10, PowerShell som standardskal (Git Bash finns också). Node 24.
- pnpm är inte installerat globalt: kör `corepack enable` och använd sedan `pnpm`.
- `supabase start` kräver Docker Desktop, som **inte är installerat än**. Steg 0 ska
  kontrollera det och be användaren installera Docker Desktop om det saknas.
- Användaren (Robert) skriver på svenska. Svara på svenska.

## Git

- Arbeta på en gren per fas (`fas-1-databas`, `fas-2-bokning` …) och slå ihop till `main`
  när fasen är klar.
- Committa bara när användaren ber om det.
