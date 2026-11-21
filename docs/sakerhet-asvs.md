# Säkerhet före piloten – ASVS-checklista och beroendeskanning

Genomgång 2026-11-18 (byggplanen, *Avslutande kontroll*, punkten Säkerhet). Specifikationen
(kapitel 10) säger OWASP ASVS nivå 2 som checklista. Här står de kritiska delarna för Bojen,
var i koden de uppfylls och vad som återstår. Full nivå 2 och penetrationstestet hör till
lanseringen, inte piloten.

Teckenförklaring: **[x]** uppfyllt och testat, **[~]** delvis eller beroende av en extern
tjänst, **[ ]** återstår.

## Sammanfattning

| Del av punkten | Status |
| --- | --- |
| Isoleringstesterna går igenom | **[x]** `packages/db/test/isolation.test.ts` går igenom alla tabeller med `tenant_id` och kräver RLS på var och en. |
| Testsviten för samtal ger 0 regelbrott | **[ ]** Väntar på steg 6.5, som kräver Claude-anrop och konto (kostar pengar). |
| Beroendeskanningen hittar inget kritiskt | **[x]** 0 kritiska. Produktionsberoenden: 0 sårbarheter. Se nedan. |
| De kritiska delarna av ASVS är avbockade | **[x]** Med de undantag som står under *Återstår*. |

## Beroendeskanning

`pnpm audit` 2026-11-18, före åtgärd: 0 kritiska, 4 höga, 5 måttliga.

Åtgärdat:

- `@serwist/next` och `serwist` 9.5.13 → 9.5.15 (zod, glob och minimatch i byggsteget).
- `next>postcss` tvingas till 8.5.33 i `pnpm-workspace.yaml` (Next 15.5 låser postcss 8.4).
- `@esbuild-kit/core-utils>esbuild` tvingas till 0.25.12 (drizzle-kit, bara lokalt).

Efter åtgärd: `pnpm audit --prod` hittar inget. Kvar finns två i utvecklingsverktyg, som aldrig
körs i produktion och inte tar emot indata utifrån:

- picomatch ≤ 4.0.7, hög (ReDoS), via eslint, vite och vitest. Ingen rättad version finns ännu.
- minimatch 10.x, måttlig, via typescript-eslint, som kräver `^10`.

Dependabot (`.github/dependabot.yml`) föreslår uppdateringar varje måndag. Snyk kräver ett
konto och är inte infört; Dependabot och `pnpm audit` täcker samma behov under piloten.

## V1–V4: Arkitektur, inloggning, session och åtkomst

- [x] **V2.1–2.2 Inloggning.** Engångskod via e-post eller sms genom Supabase Auth, som
  begränsar antalet koder. Okända adresser och nummer får samma svar (`lib/staff-auth.ts`).
- [x] **V2.4 Lagrade hemligheter.** Inga lösenord. Återställningskoder lagras som hash och
  jämförs i konstant tid (`core/crypto/recovery.ts`).
- [x] **V2.7–2.8 Andra faktorn.** TOTP krävs för ägare och administratörer (steg 2.8) och
  passkeys finns (steg 3.1). `secondFactorStep` stänger personalsidorna tills den är klar.
- [x] **V3.2–3.4 Sessionen.** Två cookies med `HttpOnly`, `SameSite=Lax` och `Secure` i
  produktion (`lib/session-cookies.ts`). Utloggning återkallar sessionen hos Supabase.
- [x] **V4.1–4.2 Åtkomst.** Varje tabell har `tenant_id` och Row Level Security, testat per
  tabell. Mekaniker stoppas från ägarens funktioner (till exempel kampanjer).
- [x] **V4.2.2 CSRF.** Personalens ändringar kräver samma Origin som Host
  (`staffFromRequest`). Kundens länkar kräver den hemliga koden i adressen.

## V5: Indata

- [x] Databasfrågor går genom Drizzle med parametrar; ingen sträng byggs till SQL.
- [x] Indata kontrolleras i routerna (telefonnummer till E.164, längder, uuid, sexsiffriga
  koder) och med zod i adaptrarna.
- [x] **V12 Filer.** Bilder och ljud har storleksgräns och tillåtna format
  (`db/src/day.ts`, `db/src/public-booking.ts`, `db/src/short-links.ts`).

## V6: Kryptografi

- [x] Koder och åtkomstinformation krypteras med AES-256-GCM och en nyckel per firma som KMS
  skyddar (`core/crypto`). Inget verktyg för röstagenten returnerar koder eller adresser.
- [x] Kortlänkar lagras bara som HMAC av koden. Webhookhemligheter jämförs i konstant tid.

## V7: Loggning – åtgärdat i denna genomgång

- [x] **V7.1.1–7.1.2 Inga personuppgifter i loggar.** Drizzle lägger frågans parametrar
  (namn, nummer och sms-texter) i felmeddelandet, och Graphile Worker både loggar det och
  sparar det i `last_error`. Nu loggas fel med `safeError` (`core/logging`): feltyp, tabell
  och Postgres-kod, aldrig värdena. Arbetarens jobb körs genom `withSafeErrors`.
- [x] Engångskoden i Supabase sms-hook loggas och lagras inte.

## V8–V9: Dataskydd och transport

- [x] Svar med koder och åtkomstinformation har `Cache-Control: no-store`.
- [x] **V9** https och TLS sköts av Caddy på den egna servern, med certifikat från Let's Encrypt (`infra/`). HSTS skickas nu (se V14).

## V13: API och webhooks

- [x] Supabase sms-hook kontrolleras med Standard Webhooks-signatur.
- [x] 46elks signerar inte. Därför krävs en hemlig token i adressen och, i produktion, en
  avsändare bland 46elks egna IP-adresser (`lib/webhooks.ts`).
- [x] Sms-koder vid bokning går bara till kända kunder och högst 3 per timme. Fel kod räknas.
  En okänd person kan alltså inte få Bojen att skicka sms till godtyckliga nummer.

## V14: Konfiguration – åtgärdat i denna genomgång

- [x] **V14.4 Säkerhetsrubriker** saknades och finns nu på varje svar (`apps/web/next.config.ts`):
  Content-Security-Policy med bara `'self'`, HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy` och inget `X-Powered-By`. Bokningssidorna får ramas in
  av firmans egen sajt (widgeten). Alla andra sidor stoppar inramning
  (`frame-ancestors 'none'` och `X-Frame-Options: DENY`).
  Testat i `e2e/security-headers.spec.ts`, som också kontrollerar att sidorna inte bryter mot sin
  egen policy.
- [x] Hemligheter ligger bara i miljövariabler; `.env.example` har namnen utan värden.

## Återstår (förslag)

- [ ] **Testsviten för samtal** (steg 6.5): kräver Claude-anrop.
- [ ] **CSP utan `'unsafe-inline'` för skript.** Next.js lägger egna skript direkt i sidan. Att
  ta bort undantaget kräver en nonce per svar via middleware, vilket gör alla sidor dynamiska.
  Bör göras före lanseringen.
- [ ] **Begränsning av anrop till den publika bokningen** (V11.1.4). Det finns ingen gräns per
  IP-adress för att skicka bokningar. Varje bokning blir en förfrågan som ägaren godkänner och
  skickar inget sms förrän då, så skadan begränsas till skräp i listan. Förslag: en gräns i Caddy
  på den egna servern när piloten startar.
- [ ] **Penetrationstest** före kommersiell lansering, enligt specifikationen.
