# Byggplan för Bojens MVP

Källa: kapitel 16 i [spec-del2.md](spec-del2.md). Den här filen är den som kodagenten följer.
Regler för hur arbetet görs finns i [../CLAUDE.md](../CLAUDE.md).

**Mål:** MVP klar och testad före pilotstart **1 mars 2027**. Vårkampanjen (steg 5.6) måste
kunna skickas cirka **20 januari 2027**.

## Status

Bocka av ett steg här (`- [x]`) först när stegets *Klart när* är uppfyllt och
`pnpm lint && pnpm typecheck && pnpm test` är grönt. Skriv samtidigt en rad i
[changelog.md](changelog.md).

- [x] Steg 0 – Repo, verktyg och CI (1 dag)
- [x] Steg 1.1 – Kärnentiteter (1 dag)
- [x] Steg 1.2 – Platser, placering och åtkomst (1 dag)
- [x] Steg 1.3 – Tjänster, jobb, besök och delar (1 dag)
- [x] Steg 1.4 – Kommunikation och automation (1 dag)
- [x] Steg 1.5 – Isolering mellan firmor och testdata (1,5 dagar)
- [x] Steg 1.6 – Kryptering av fält (1 dag)
- [x] Steg 2.1 – Kapacitet och lediga tider (1,5 dagar)
- [x] Steg 2.2 – Restider (1 dag)
- [x] Steg 2.3 – Poäng för tider (2 dagar)
- [x] Steg 2.4 – API och tillståndsmaskin för bokning (1,5 dagar)
- [x] Steg 2.5 – Bokningssida och widget (3 dagar)
- [ ] Steg 2.6 – Manuellt godkännande (0,5 dag)
- [ ] Steg 3.1 – Notifieringstjänst och mallmotor (2 dagar)
- [ ] Steg 3.2 – Inkommande sms och tolkning av svar (2 dagar)
- [ ] Steg 3.3 – Flöden för bekräftelse, ankomsttid och rapport (1,5 dagar)
- [ ] Steg 3.4 – Korta länkar och kundsida (1 dag)
- [ ] Steg 4.1 – Schemaläggning av kontrollen (1 dag)
- [ ] Steg 4.2 – Tillståndsmaskin för svaren (1,5 dagar)
- [ ] Steg 4.3 – Väntelista och återfyllnad (1,5 dagar)
- [ ] Steg 5.1 – Kundlista, sökning och kundkort (2 dagar)
- [ ] Steg 5.2 – Båtkort med tidslinje (2 dagar)
- [ ] Steg 5.3 – Marinakort (1 dag)
- [ ] Steg 5.4 – Pipeline (1 dag)
- [ ] Steg 5.5 – Mekanikerns dagvy som PWA, offline (3 dagar)
- [ ] Steg 5.6 – Vårkampanj, enkel version (2 dagar)
- [ ] Steg 6.1 – Verktygs-API för agenten (1,5 dagar)
- [ ] Steg 6.2 – Röstagenten (4 dagar)
- [ ] Steg 6.3 – Efterbearbetning (1,5 dagar)
- [ ] Steg 6.4 – Kopplingsregler och reservrutin (1,5 dagar)
- [ ] Steg 6.5 – Testsvit för samtal (2 dagar)
- [ ] Steg 7.1 – KPI-vyer (2 dagar)
- [ ] Steg 7.2 – Dashboard i mobilen (2 dagar)
- [ ] Steg 7.3 – Statistik för receptionisten (0,5 dag)
- [ ] Steg 8 – Fortnox (2–3 dagar, när partneravtalet är klart)
- [ ] Avslutande kontroll före piloten

## Avvikelser från specifikationen

Specifikationens arkitektur i del 1 (NestJS, AWS ECS, PowerSync, inbyggd app) är **målbilden**.
För MVP:n gäller den mindre stacken nedan. Den ska gå att flytta till AWS senare.

| Del | MVP |
|---|---|
| Monorepo | pnpm + Turborepo |
| `apps/web` | Next.js 15 (App Router): administration, bokningssida, widget, API-rutter, webhooks. Vercel arn1. |
| `apps/worker` | Node + Graphile Worker |
| `apps/voice` | LiveKit Agents (TypeScript) |
| `packages/db` | Drizzle ORM + migreringar mot Supabase Postgres (eu-north-1) med PostGIS |
| `packages/core` | Ren domänlogik utan I/O |
| Restider | OSRM (öppen källkod, OpenStreetMap) på egen server i stället för Google Routes |
| Adressökning | Photon (öppen källkod, OpenStreetMap) i stället för Google Places |
| `packages/adapters` | 46elks, Mailgun, OSRM, Azure, Claude, Fortnox, KMS – var och en med fejkimplementation |
| Tester | Vitest (enhet + databas via `supabase start`) och Playwright |
| Mekanikerns app | PWA (Serwist + IndexedDB), inte React Native |

Om ett steg visar att ett val ovan inte håller: stanna, beskriv problemet och föreslå
ett alternativ i stället för att byta tyst.

## Stegen

**Format:** *Mål*, *Berör*, *Gör*, *Klart när*. Uppskattad tid anges för en utvecklare som arbetar med Claude Code.

---

#### Steg 0 – Repo, verktyg och CI (1 dag)
- **Mål:** Ett körbart monorepo med tester och CI.
- **Berör:** Roten, `apps/web`, `apps/worker`, `packages/{db,core,adapters}`, `.github/workflows/ci.yml`, `CLAUDE.md`, `docs/`.
- **Gör:**
  - Sätt upp Turborepo med TypeScript strict, ESLint, Prettier och Vitest.
  - Konfigurera lokal Supabase via `supabase start`.
  - Lägg in en `.env.example`.
  - Kopiera del 1 och 2 av specifikationen till `docs/`.
- **Klart när:** `pnpm install && pnpm test` går igenom. CI kör lint, typkontroll och tester på varje push.

### Fas 1: Databas och datamodell

#### Steg 1.1 – Kärnentiteter (1 dag)
- **Mål:** Tabeller för firmor, användare, kunder, båtar och motorer.
- **Berör:** `packages/db/schema/{tenant,user,customer,boat,engine}.ts`, migrering 0001.
- **Gör:**
  - Skapa `tenant`, `app_user` (roll som enum), `customer` (typ som enum, telefon i E.164 med unikt index per firma), `boat`, `boat_ownership` (N:M med roll), `engine`, `drive` och `engine_hours_reading`.
  - Lägg till mjuk radering och tidsstämplar.
- **Klart när:** Migreringen körs. Ett test skapar en kund med två båtar och en båt med två delägare.

#### Steg 1.2 – Platser, placering och åtkomst (1 dag)
- **Mål:** Geografin och var båten står.
- **Berör:** `schema/{location,boat_placement,access_info,area}.ts`, migrering 0002 (PostGIS).
- **Gör:**
  - Skapa `location` med `geography(Point)`, åtkomstsätt och tid för överfart.
  - Skapa `location_access_rule`, `boat_placement` (säsong, läge, plats-ID, datum för sjösättning och upptagning), `access_info` (krypterade kolumner som `bytea`) och `area` (polygon).
- **Klart när:** Ett test hittar den placering som gäller för en båt på ett visst datum (sommar eller vinter). En sökning på avstånd mellan två marinor fungerar.

#### Steg 1.3 – Tjänster, jobb, besök och delar (1 dag)
- **Mål:** Datamodellen för arbetsordrar.
- **Berör:** `schema/{service_type,job,visit,job_line,part,job_part,supplier}.ts`, migrering 0003.
- **Gör:**
  - Skapa `job` (pipelinestatus som enum, hur brådskande, kanal) och `visit` (status och tillgänglighetsstatus som enums, tidsfönster som `tstzrange`).
  - Lägg in ett exkluderingsvillkor som hindrar överlappande besök för samma mekaniker.
- **Klart när:** Ett test visar att en överlappande bokning för samma mekaniker avvisas av databasen.

#### Steg 1.4 – Kommunikation och automation (1 dag)
- **Mål:** Tabeller för meddelanden, samtal, ärenden och kampanjer.
- **Berör:** `schema/{message,call,task,waitlist_entry,campaign,campaign_recipient,survey,consent,audit_log,kpi_snapshot}.ts`.
- **Klart när:** Migreringen körs. Index finns på `message(tenant_id, customer_id, created_at)` och `task(tenant_id, status, due_at)`.

#### Steg 1.5 – Isolering mellan firmor och testdata (1,5 dagar)
- **Mål:** Row Level Security på alla tabeller och realistisk testdata.
- **Berör:** `packages/db/rls.sql`, `packages/db/seed.ts`, `packages/db/test/isolation.test.ts`.
- **Gör:**
  - Skapa policyer som går via `auth.jwt() ->> 'tenant_id'`.
  - Testdata:
    - Firman *Jonas Båtservice* med 2 mekaniker.
    - Marinorna Bullandö, Djurö Båtvarv, Saltsjöbadens BK och Sandhamn (gästhamn) med riktiga koordinater.
    - 40 kunder och 45 båtar med blandade märken.
    - Förra årets besök, som behövs för kampanjerna.
  - Skapa en andra firma för isoleringstester.
- **Klart när:** Ett test som itererar över **alla** tabeller visar att firma B inte kan läsa, skriva eller radera firma A:s rader.

#### Steg 1.6 – Kryptering av fält (1 dag)
- **Mål:** Koder krypteras och dekrypteras bara via en gemensam modul.
- **Berör:** `packages/core/crypto/*`, `packages/adapters/kms/{aws,local}.ts`.
- **Gör:**
  - Implementera AES-256-GCM med datanyckel per firma, krypterad av en KMS-adapter (lokal nyckel i utvecklingsmiljön).
  - Skapa funktionerna `encryptAccess` och `decryptAccess(userId, visitId)`, där den senare kontrollerar regeln om tidsfönster och skriver till `audit_log`.
- **Klart när:**
  - Enhetstesterna går igenom.
  - Ett test visar att dekryptering utanför tidsfönstret eller av fel mekaniker avvisas och loggas.
  - Ett test letar efter kod i klartext i loggutskrifterna och hittar ingen.

### Fas 2: Bokningsflödet

#### Steg 2.1 – Kapacitet och lediga tider (1,5 dagar)
- **Mål:** Räkna fram lediga tidsfönster per mekaniker och dag.
- **Berör:** `packages/core/scheduling/availability.ts`, `schema/work_schedule.ts`.
- **Gör:** Utgå från arbetsschema, blockeringar och befintliga besök. Lediga intervall delas in i firmans tidsfönster. Tjänstens längd och buffert räknas in.
- **Klart när:** Tabelldrivna tester för minst 12 fall går igenom (heldag, delvis bokad, för lång tjänst, helg, sommartid och vintertid).

#### Steg 2.2 – Restider (1 dag)
- **Mål:** En avståndsmatris med cache.
- **Berör:** `packages/adapters/maps/{osrm,fake}.ts`, `packages/core/scheduling/travel.ts`, tabellen `travel_cache`.
- **Gör:**
  - OSRM (OpenStreetMap) används i produktion. Ändrat från Google Routes 2026-11-11 för att slippa kostnaden per anrop.
  - Fejkadaptern räknar fågelvägen × 1,4 och 50 km/h.
  - Platser som nås med båt eller färja får extra tid för överfart.
  - Resultaten cachas per par av platser och timme.
- **Klart när:** Tester visar att cachen används vid andra anropet och att tiden för överfart läggs till.

#### Steg 2.3 – Poäng för tider (2 dagar)
- **Mål:** Ranka tider enligt formeln i del 1, kapitel 4.2.
- **Berör:** `packages/core/scheduling/suggest.ts`.
- **Gör:**
  - Skapa funktionen `suggestSlots({tenant, serviceType, location, mode, earliest, partsLeadDays})`.
  - Den räknar ut extra körtid för varje tänkbar tid, lägger på marinabonus och straff för väntetid, filtrerar på krav på läge (till exempel bara efter upptagningsdatum när tjänsten kräver land) och på delarnas ledtid.
  - Den returnerar topp-N med flaggorna `marinaDay` och `discount`.
- **Klart när:** Tester visar att:
  - En tid på Bullandö samma dag som ett annat Bullandö-jobb rankas först.
  - Ett bälgbyte aldrig föreslås före upptagningen.
  - En del med 5 dagars ledtid flyttar den tidigaste tiden.

#### Steg 2.4 – API och tillståndsmaskin för bokning (1,5 dagar)
- **Mål:** Skapa, bekräfta, boka om och avboka på ett säkert sätt.
- **Berör:** `packages/core/booking/stateMachine.ts`, `apps/web/app/api/bookings/*`.
- **Gör:**
  - Bygg en tillståndsmaskin för besök med statusarna i del 1, kapitel 6.
  - Lägg in idempotensnyckel och transaktion med radlås, så att två kunder inte kan boka samma tid samtidigt.
  - Varje ändring genererar en händelse i `domain_event`.
- **Klart när:**
  - Enhetstester visar att otillåtna övergångar avvisas.
  - Ett test med samtidiga anrop visar att två parallella bokningar av samma tid ger en lyckad och en `409`.

#### Steg 2.5 – Bokningssida och widget (3 dagar)
- **Mål:** Kunderna kan boka själva.
- **Berör:** `apps/web/app/(public)/boka/[tenant]/*`, `apps/web/widget/` (web component), `packages/core/i18n/sv.ts`.
- **Gör:**
  - Bygg en guide i sex steg enligt del 1, kapitel 4.2.
  - Befintliga kunder identifieras med engångskod via sms (fejkadapter i tester).
  - Plats väljs via lista över marinor eller adress (Photon på OpenStreetMap; ändrat från Google Places 2026-11-11 för att slippa kostnaden per sökning).
  - Bilder laddas upp till Supabase Storage.
  - Marinadagar visas med rabatt.
  - Marinalänken `/m/[location]` förväljer platsen.
- **Klart när:**
  - Ett Playwright-test går igenom: ny kund bokar vinterkonservering på Bullandö och väljer en marinadag, och bokningen finns sedan i databasen.
  - Lighthouse ger minst 90 i prestanda på mobil.
  - Widgeten fungerar inbäddad i en statisk HTML-testsida.

#### Steg 2.6 – Manuellt godkännande (0,5 dag)
- **Mål:** Inställning per tjänst och kundtyp för hur bokningar bekräftas.
- **Berör:** `schema/tenant_settings.ts`, `apps/web/app/(admin)/forfragningar/*`.
- **Klart när:** Ett test visar att en ny kunds bokning blir `pending_approval` och att den blir `booked` när mekanikern godkänner den.

### Fas 3: Sms och e-post

#### Steg 3.1 – Notifieringstjänst och mallmotor (2 dagar)
- **Mål:** En enda väg ut för alla meddelanden.
- **Berör:** `packages/core/messaging/{templates,segments,render}.ts`, `packages/adapters/{elks,mailgun}/*`, `apps/worker/tasks/sendMessage.ts`.
- **Gör:**
  - Mallarna från del 1, kapitel 7, läggs i en fil som är typad.
  - Segmenträknaren hanterar GSM-7 och UCS-2.
  - Tysta timmar 21:00–08:00 respekteras.
  - Listan över avregistrerade (STOPP) kontrolleras.
  - Allt loggas i `message`, och leveransstatus tas emot via webhook.
- **Klart när:**
  - Enhetstester visar att varje mall renderas med testdata och håller sin segmentgräns.
  - Ett sms till ett avregistrerat nummer stoppas.
  - Ett sms kl. 22:30 köas till kl. 08:00.

#### Steg 3.2 – Inkommande sms och tolkning av svar (2 dagar)
- **Mål:** Koppla svar till rätt sammanhang och tolka dem.
- **Berör:** `apps/web/app/api/webhooks/elks/sms/route.ts`, `packages/core/messaging/{routeInbound,intent}.ts`, `packages/adapters/llm/{claude,fake}.ts`.
- **Gör:**
  - Ett svar kopplas till senaste öppna fråga från samma nummer (tillgänglighetskontroll, kampanj, väntelista eller nöjdhetsfråga).
  - Tolkningen sker i två steg: först regler (`ja`, `j`, `japp`, 👍, `nej`, `ändra`, `stopp`, `annan`, `1`–`5`), sedan Claude Sonnet 5.5 med strukturerat svar `{intent, confidence}` för fritext.
  - Om säkerheten är under 0,9 skapas ett ärende.
- **Klart när:**
  - Minst 40 testfall för tolkningen går igenom.
  - Ett svar på en äldre fråga kopplas inte till fel besök.
  - Ett test visar att signaturen på webhooken från 46elks verifieras.

#### Steg 3.3 – Flöden för bekräftelse, ankomsttid och rapport (1,5 dagar)
- **Mål:** Flödena F1, F5, F7 och F9 från del 1.
- **Berör:** `apps/worker/flows/{confirmation,morningEta,serviceReport,survey}.ts`.
- **Klart när:** Ett integrationstest med fejkklocka visar att en bokning ger bekräftelse direkt, att sms med ankomsttid skickas kl. 07 samma dag och att nöjdhetsfrågan skickas 18 timmar efter att jobbet är klart. Rätt mallar används.

#### Steg 3.4 – Korta länkar och kundsida (1 dag)
- **Mål:** Kunden kan boka om, avboka och lägga in koder via en länk.
- **Berör:** `apps/web/app/(public)/x/[code]/*`, tabellen `short_link`.
- **Gör:**
  - Signerade engångslänkar med utgångstid.
  - Vyer för ombokning och avbokning (med avbokningsgräns).
  - Ett formulär för åtkomst, där koden krypteras med modulen från steg 1.6.
- **Klart när:** Ett Playwright-test visar att en kund kan boka om via länken, att den gamla tiden frigörs och att en utgången länk ger ett felmeddelande.

### Fas 4: 24-timmarskontrollen

#### Steg 4.1 – Schemaläggning av kontrollen (1 dag)
- **Mål:** Kontrollen skickas vid rätt tidpunkt.
- **Berör:** `packages/core/availability/schedule.ts`, `apps/worker/flows/availabilityCheck.ts`.
- **Gör:** Implementera reglerna i del 1, F3: start minus 24 timmar, flyttning från tysta timmar till 18:00, besök på måndagar kontrolleras fredag kl. 12, bokningar gjorda mindre än 24 timmar innan hoppas över och akutjobb hoppas över.
- **Klart när:** Minst 10 tabelldrivna tester går igenom.

#### Steg 4.2 – Tillståndsmaskin för svaren (1,5 dagar)
- **Mål:** Hantera JA, NEJ, ÄNDRA, fritext och uteblivet svar.
- **Berör:** `packages/core/availability/stateMachine.ts`, `apps/worker/flows/availabilityFollowup.ts`.
- **Gör:** Följ tabellen i del 1, F3: påminnelse efter 4 timmar, ärendet *Ring kund* kl. 18 dagen innan, gul status och ingen automatisk avbokning.
- **Klart när:** Ett test med fejkklocka går igenom alla grenar: JA ger `confirmed`, NEJ ger avbokning och startar väntelisteflödet, ÄNDRA ger ärende, uteblivet svar ger påminnelse och därefter ärende.

#### Steg 4.3 – Väntelista och återfyllnad (1,5 dagar)
- **Mål:** Flöde F4.
- **Berör:** `packages/core/waitlist/match.ts`, `apps/worker/flows/waitlistOffer.ts`.
- **Gör:** Matcha på område eller avstånd inom 10 km, tjänstens längd, krav på läge och datumintervall. Erbjudandet skickas i omgångar om 5 kunder, och den som svarar JA först får tiden. Därefter går erbjudandet till nästa omgång, högst tre omgångar.
- **Klart när:** Ett test med tre kunder på väntelistan som alla svarar JA visar att exakt en får tiden och att de två andra får sms om att tiden är tagen. Den som svarar efter att tiden är tagen får också sms om det.

### Fas 5: CRM-vyer

#### Steg 5.1 – Kundlista, sökning och kundkort (2 dagar)
- **Berör:** `apps/web/app/(admin)/kunder/*`, sökindex (`pg_trgm`).
- **Klart när:** En sökning på telefon, namn, båtmodell, serienummer eller marina tar under 300 ms med 5 000 kunder i testdata. Kundkortet visar båtar, besök och en tidslinje med meddelanden.

#### Steg 5.2 – Båtkort med tidslinje (2 dagar)
- **Berör:** `apps/web/app/(admin)/batar/[id]/*`.
- **Gör:** Visa placering per säsong, motorer och drev, graf över gångtimmar, servicehistorik, rekommendationer, bilder och åtkomst (dold, med knapp för att visa och logg).
- **Klart när:** Ett Playwright-test visar att en mekaniker utan besök på båten inte kan se koden, och att ägaren kan se den efter bekräftelse och att visningen loggas.

#### Steg 5.3 – Marinakort (1 dag)
- **Berör:** `apps/web/app/(admin)/marinor/*`.
- **Klart när:** Kortet visar kontaktpersoner, regler för tillträde, båtar som står där, datum för sjösättning och upptagning och marinans bokningslänk.

#### Steg 5.4 – Pipeline (1 dag)
- **Berör:** `apps/web/app/(admin)/pipeline/*`.
- **Klart när:** Det går att dra kort mellan kolumnerna. Statusen ändras automatiskt när ett besök är klart (blir *Utfört*) och när en faktura skapas (blir *Fakturerat*).

#### Steg 5.5 – Mekanikerns dagvy som PWA, offline (3 dagar)
- **Mål:** En användbar arbetsvy i fält.
- **Berör:** `apps/web/app/(mek)/idag/*`, service worker (Serwist), offlinekö i IndexedDB, `packages/core/reports/draft.ts`.
- **Gör:**
  - Dagens rutt med ordningsförslag (pröva alla ordningar om antalet stopp är högst 8).
  - Starta och Klart, gångtimmar, delar, bilder och röstanteckning (transkriberas av Azure när täckning finns).
  - Utkast till rapport från Claude Sonnet 5.5, som mekanikern godkänner.
  - Fakturaunderlag.
- **Klart när:**
  - Ett Playwright-test i offline-läge går igenom: mekanikern markerar ett jobb klart med bild och anteckning, och när nätet kommer tillbaka synkas allt och rapportutkastet skapas.
  - Lighthouse godkänner PWA:n.

#### Steg 5.6 – Vårkampanj, enkel version (2 dagar)
- **Mål:** Flöde F11 med standardsegment.
- **Berör:** `packages/core/campaigns/{segment,proposeSlot}.ts`, `apps/worker/flows/campaign.ts`, `apps/web/app/(admin)/kampanjer/*`.
- **Gör:**
  - Segment A, B och C enligt del 1.
  - Reservation i samma vecka som förra året, grupperad per marina.
  - Utskick i omgångar.
  - Svaret JA blir en bokning, ANNAN ger en länk och NEJ ger frågan om båten är såld.
  - Reservationen släpps efter 14 dagar.
- **Klart när:** Med testdatan (förra året) skapar en kampanj reservationer i rätt vecka, och svaret JA ger ett bokat besök och sms enligt F1.

### Fas 6: Receptionisten

#### Steg 6.1 – Verktygs-API för agenten (1,5 dagar)
- **Mål:** Säkra API-anrop för verktygen i kapitel 8.2.
- **Berör:** `apps/web/app/api/voice-tools/*`, `packages/core/voice/tools.ts`.
- **Gör:**
  - Kortlivad token per samtal och firma.
  - Inget verktyg returnerar koder eller adresser.
  - Kontrollfrågan krävs före ombokning och avbokning.
- **Klart när:** Kontraktstester finns för varje verktyg. Ett test visar att `hitta_kund` aldrig returnerar åtkomstinformation.

#### Steg 6.2 – Röstagenten (4 dagar)
- **Mål:** Ett fungerande samtal från telefonnummer till bokning.
- **Berör:** `apps/voice/*` (LiveKit Agents), `apps/voice/prompts/system.sv.md` (prompten i 8.2), konfigurationen av SIP-trunk hos 46elks.
- **Gör:**
  - Pipeline: Azure STT sv-SE med ordlista, Claude Haiku 5.5 med effort `low` och cachad prompt, Azure TTS och brusreducering.
  - Kundkontexten läggs in före första repliken.
  - Avbrott när kunden börjar prata (barge-in).
- **Klart när:** Ett manuellt testsamtal till ett testnummer bokar en tid, och bokningen syns i administrationen. Svarstiden p90 är under 1,2 s, mätt i loggarna under 20 testsamtal.

#### Steg 6.3 – Efterbearbetning (1,5 dagar)
- **Berör:** `apps/worker/flows/postCall.ts`, `packages/core/voice/summarize.ts`, `packages/core/vision/nameplate.ts`.
- **Gör:**
  - Spara transkribering, sammanfattning i 5 punkter och utfall, och koppla samtalet till ett jobb.
  - Tolkning av typskyltsbild (Claude Sonnet 5.5 med bildtolkning) ger förslag på märke, modell och serienummer som mekanikern bekräftar.
  - Rensa bort kort- och personnummer.
- **Klart när:** Tester med 5 riktiga typskyltsbilder (Volvo Penta, Mercury, Yamaha, Suzuki och Honda) ger rätt modell i minst 4 av 5 fall.

#### Steg 6.4 – Kopplingsregler och reservrutin (1,5 dagar)
- **Berör:** `packages/core/voice/escalation.ts`, `apps/voice/transfer.ts`, reservnummer hos 46elks.
- **Gör:** Implementera K1–K10: medhörning med tidsgräns på 20 s, push med kritiskt ljud, vidarekoppling till nästa jourmekaniker efter 30 min, och vidarekoppling av samtalet till mekanikern när agenten är nere.
- **Klart när:**
  - Enhetstester av beslutsträdet går igenom.
  - Ett test där agentprocessen stängs av visar att samtalet går till mekanikerns nummer.

#### Steg 6.5 – Testsvit för samtal (2 dagar)
- **Mål:** Kvalitetssäkring före varje release av röstagenten.
- **Berör:** `apps/voice/evals/*`.
- **Gör:**
  - 30 simulerade samtal i textform, där en simulerad kund drivs av Claude: haveri med fara, haveri utan fara, återkommande kund, delägare, försök att få ut en kod, prisförhandling, engelsktalande kund, säljare och otydliga svar.
  - Bedömning per samtal: rätt åtgärd, alla obligatoriska fält insamlade och inga regelbrott.
- **Klart när:** Svaret är rätt i minst 90 % av fallen och det förekommer **0** regelbrott (kod utlämnad, felaktigt pris eller utebliven hänvisning till 112). Sviten körs i CI på ändringar i `apps/voice/`.

### Fas 7: Dashboard

#### Steg 7.1 – KPI-vyer (2 dagar)
- **Berör:** `packages/db/views/kpi_*.sql`, `apps/worker/tasks/refreshKpis.ts`, `kpi_snapshot`.
- **Gör:** Skapa materialiserade vyer för KPI:erna i MVP:n (se 12.1) och dagliga ögonblicksbilder.
- **Klart när:** Varje KPI har ett test mot testdatan med ett förväntat värde som räknats ut för hand.

#### Steg 7.2 – Dashboard i mobilen (2 dagar)
- **Berör:** `apps/web/app/(admin)/oversikt/*`.
- **Klart när:** Layouten följer skissen i 9.2 vid 360 px bredd, färgerna följer målen, korten går att trycka på och listan *Att göra* visar de öppna ärendena. Ett Playwright-test med skärmdump på mobil går igenom.

#### Steg 7.3 – Statistik för receptionisten (0,5 dag)
- **Klart när:** KPI 21–24 visas och samtalslistan kan filtreras på utfall.

### Steg 8 – Fortnox (2–3 dagar, när partneravtalet är klart)
- **Berör:** `packages/adapters/fortnox/*`, `apps/web/app/(admin)/installningar/integrationer/*`.
- **Gör:** Koppling via OAuth 2, synk av kunder och artiklar, faktura skapas från fakturaunderlaget och betalstatus hämtas via polling.
- **Klart när:** Ett test i Fortnox sandlåda skapar en faktura och statusen *Betald* hämtas tillbaka.

### Avslutande kontroll före piloten (3 dagar)

- [ ] Hela kedjan i Playwright: bokning på webben → bekräftelse → 24-timmarskontroll med JA → dagvy offline → Klart → rapport → nöjdhetsfråga med betyg 5 → länk till recension.
- [ ] Belastningstest: 20 samtidiga röstsamtal och 500 sms per minut genom kön.
- [ ] Säkerhet: isoleringstesterna går igenom, testsviten för samtal ger 0 regelbrott, beroendeskanningen hittar inget kritiskt och de kritiska delarna av ASVS-checklistan är avbockade.
- [ ] Juridik: personuppgiftsbiträdesavtal, villkor, integritetspolicy, mall för konsekvensbedömning och publik lista över underbiträden.
- [ ] Onboarding: importmall för Excel, guide för nummerportering hos 46elks och utbildningsvideo på 10 minuter för pilotfirmorna.

**Summa:** cirka 70 utvecklardagar, alltså cirka 16 veckor med två utvecklare inklusive marginal. Det stämmer med tidsplanen i 12.1.

---
