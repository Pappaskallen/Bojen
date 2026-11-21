# Konton och tjänster som behövs

Sammanställt 2026-11-21 utifrån MVP-stacken i `docs/byggplan.md`, `.env.example` och
specifikationens kapitel 10, 11 och 13. Priserna är lästa på leverantörernas prissidor samma dag,
exklusive moms. De ändras, så kontrollera dem innan du väljer plan. Där ett pris inte gick att
läsa står det.

## Gör så här

1. **Bolaget först.** Skapa alla konton i Bojen AB:s namn med en adress på bolagets domän, inte
   en privat adress. Slå på tvåfaktor överallt och lägg in en budgetgräns eller ett larm där det
   går.
2. **Det som låser upp de sista byggstegen** (6.2b, 6.3 och 6.5b): Anthropic, Azure Speech,
   46elks och LiveKit. Med dem kan röstagenten testas på riktigt.
3. **Det som tar tid att få:** ansökan om integrationspartner hos Fortnox (steg 8) och avtalet om
   nolllagring (ZDR) hos Anthropic. Skicka båda nu.
4. **Produktionen** inför piloten: Supabase, Vercel, en server för arbetaren och kartorna, AWS
   KMS, Mailgun och Sentry.

Ge mig nycklarna genom att lägga dem i `.env.local` (och som hemligheter i GitHub och Vercel).
Klistra aldrig in dem i chatten.

## 1. Grunden

| Vad | Varför | Konto och val | Kostnad |
|---|---|---|---|
| Bojen AB | Avtalspart i alla konton och i PUB-avtalet. Organisationsnumret saknas i juridikutkasten. | Bolagsverket | Engångsavgift |
| Domänen `bojen.se` | Webbappen, kortlänkarna `bojen.se/x/…`, e-postdomänen `mg.bojen.se` och `dataskydd@bojen.se` | En svensk registrar med DNS du styr själv | Några hundra kronor per år |
| E-post för bolaget | `dataskydd@bojen.se` och adressen som äger kontona | Valfri tjänst med servrar inom EU | Från cirka 50 kr per användare och månad |
| GitHub | Koden och CI finns redan. Repot behöver hemligheter för CI (`ANTHROPIC_API_KEY` för testsviten för samtal). | Befintligt konto | 0 kr |

## 2. Det som behövs för att bygga klart

### Anthropic (Claude): steg 3.2, 5.5, 6.2, 6.3 och 6.5

- **Vad:** ett API-konto på Claude-plattformen med en organisation för Bojen. Där skapas en
  API-nyckel (`ANTHROPIC_API_KEY`), och där sätts en månadsgräns för kostnaden.
- **Används till:**
  - receptionisten (Haiku 5.5);
  - tolkning av sms-svar, rapportutkast och typskyltar (Sonnet 5.5);
  - testsviten för samtal.
- **Kostnad:** betalas per token. Den första körningen av testsviten visar vad ett samtal kostar.
- **Begär ZDR-avtal (nolllagring).** Specifikationen lovar att inga transkriberingar lagras hos
  amerikanska underbiträden (juridik, öppen fråga 2). Utan avtalet måste texterna ange
  Anthropics lagringstid i stället.
- **Underbiträde:** ja, i USA. Det står redan på listan.

### Microsoft Azure: tal till text och text till tal (steg 6.2)

- **Vad:** en Azure-prenumeration med en Speech-resurs i regionen **Sweden Central**. Den ger
  `AZURE_SPEECH_KEY` och `AZURE_SPEECH_REGION=swedencentral`.
- **Kostnad:**
  - Gratisnivån (F0) ger 5 timmar transkribering och 0,5 miljoner tecken neural röst per månad.
    Det räcker för testerna.
  - Priset för betalnivån gick inte att läsa på prissidan. Räkna i Azures priskalkylator för
    Sweden Central. Specen räknar med 0,60 kr per minut röst totalt.
- **Underbiträde:** ja, inom EU. Det står redan på listan.

### 46elks: sms, telefoni och nummer (steg 3.x och 6.x)

- **Vad:** ett konto som ger `ELKS_API_USERNAME` och `ELKS_API_PASSWORD`.
- **Nummer:**
  - ett testnummer för röstagenten, med `voice_start` mot webbappen;
  - ett nummer per pilotfirma, eller deras egna nummer porterade in.
- **Sms:** för avsändarnamnet `Bojen` behövs inget eget nummer. För att ta emot svar behövs ett
  nummer.
- **Kostnad:**

  | Vad | Pris |
  |---|---|
  | Sms till Sverige | 0,52 kr per sms-del |
  | Ta emot sms | 0 kr, men kräver ett nummer |
  | Virtuellt nummer, fast eller mobilt | 30 kr per månad |
  | Samtal till mobil | 0,57 kr per påbörjad minut |
  | Samtal till fast nummer | 0,15 kr per påbörjad minut |
  | Koppla samtal till egen SIP eller webRTC | 0 kr |
  | Koppla samtal till extern SIP-trunk | 0,10 kr per minut |
  | SIP-användare | 30 kr per månad |

- **Nummerportering:** priset är "ring oss". Frågorna att ställa står i
  `docs/onboarding/nummerportering.md`.
- **Underbiträde:** ja, i Sverige.

### LiveKit: röstagentens ljud (steg 6.2b)

Här finns ett val att göra (juridik, öppen fråga 4).

| Alternativ | Kostnad | Följd |
|---|---|---|
| **A. LiveKit Cloud, Ship** | 50 USD per månad. 5 000 agentminuter ingår, sedan 0,01 USD per minut. 5 000 SIP-minuter ingår. | Enklast att komma igång. LiveKit blir underbiträde för samtalsljudet, och var ljudet behandlas behöver kontrolleras. LiveKits egna telefonnummer finns bara i USA, men vi använder 46elks nummer via SIP, så det spelar ingen roll. |
| **B. LiveKit på egen server** | Ingår i serverkostnaden nedan | Ljudet stannar i vår drift inom EU, och driftleverantören är underbiträde i stället. Vi får mer att sköta själva: uppdateringar, TURN och övervakning. |

**Mitt förslag:** A (gratisnivån Build räcker) för testsamtalen i steg 6.2b, och sedan B inför
piloten om löftet om EU och ljud ska hålla. Variablerna är `LIVEKIT_URL`, `LIVEKIT_API_KEY` och
`LIVEKIT_API_SECRET`.

### Fortnox: bokföring (steg 8)

- **Vad:** ett utvecklarkonto och en ansökan om att bli integrationspartner. Det ger
  `FORTNOX_CLIENT_ID` och `FORTNOX_CLIENT_SECRET`.
- **Skicka ansökan nu.** Godkännandet tar tid, och steg 8 väntar på det. Specen säger samma sak.
- **Testföretag:** ett Fortnox-konto att testa mot behövs. Det kan vara en pilotfirmas, med deras
  tillstånd.

## 3. Produktion inför piloten

| Tjänst | Konto och plan | Region | Kostnad | Variabler |
|---|---|---|---|---|
| **Supabase** | Pro, ett produktionsprojekt (lokalt används `supabase start`). Inställningarna som krävs står i byggplanens punkt Drift inom EU. | Stockholm, eu-north-1. Kontrollera att regionen går att välja; prissidan nämner inte regioner. | Pro 25 USD per månad, med en Micro-instans (1 GB RAM). Small 15 USD och Medium 60 USD. Återställning till valfri tidpunkt i 7 dagar, som specen kräver, kostar 100 USD per månad. | `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_AUTH_SMS_HOOK_SECRET` |
| **Vercel** | Pro, eftersom Hobby är för privat bruk och har tak för användningen | Stockholm (arn1) | 20 USD per utvecklarplats och månad | Alla webbappens variabler i projektets inställningar |
| **Server för arbetaren, röstagenten och kartorna** | En virtuell server, till exempel Hetzner Cloud CPX32 (4 vCPU, 8 GB RAM). Två servrar om LiveKit körs själv (alternativ B): en för arbetaren och röstagenten, en för OSRM och Photon. | Helsingfors | 30,49 EUR per månad och server. Nürnberg kostar 35,99 EUR. | `OSRM_URL`, `PHOTON_URL`, `VOICE_AGENT_SIP`, `VOICE_AGENT_HEALTH_URL` |
| **AWS** | Ett konto med en kundhanterad KMS-nyckel och en IAM-användare som bara får använda nyckeln | Stockholm, eu-north-1 | 1 USD per nyckel och månad, och 0,03 USD per 10 000 anrop. 20 000 anrop per månad är gratis. | `KMS_KEY_ID` och AWS-nycklarna för IAM-användaren |
| **Mailgun** | En plan med EU-region och egen domän, `mg.bojen.se` | EU | Basic 15 USD per månad för 10 000 mejl. Foundation 35 USD för 50 000 mejl. Kontrollera att planen du väljer har EU-regionen; sidan anger det inte per plan. | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM` |
| **Sentry** | Felövervakning enligt specen 11, med EU som datalagringsregion | EU | Developer är gratis för 1 användare och 5 000 fel per månad. Team kostar 29 USD per månad. | Inte inkopplad i koden ännu; det blir ett litet eget steg |

**Valet av driftleverantör** (juridik, öppen fråga 3) är ditt:
- **Hetzner** ligger inom EU och är billigt, men är tyskt och har ingen svensk region.
- **En svensk leverantör** ger drift i Sverige. UpCloud har en region i Stockholm, men prissidan
  gick inte att läsa.

Det leverantören du väljer blir underbiträde och läggs till på `/underbitraden`.

**Nycklar som inte kräver konto:** jag tar fram dem när produktionen sätts upp. Det gäller
`SHORT_LINK_KEY`, `SMS_OPT_OUT_KEY`, `BOOKING_SESSION_SECRET`, `ELKS_WEBHOOK_SECRET`,
`VOICE_TOOLS_SECRET`, `VOICE_SERVICE_SECRET` och VAPID-nycklarna för webbpush. `SMS_OPT_OUT_KEY`
och `SHORT_LINK_KEY` måste dessutom säkerhetskopieras, eftersom de inte går att byta.

## 4. Inte konton, men köp före kommersiell lansering

Från specens 10.7 och 13.

| Vad | Uppskattning i specen |
|---|---|
| Jurist som granskar utkasten i `docs/juridik/` | Ingår i 60 000–70 000 kr per år för jurist och säkerhet |
| Penetrationstest | 50 000–80 000 kr |
| Försäkring (ansvar och cyber) | Cirka 800 kr per månad |

## 5. Senare (version 2), inget behövs nu

- **Stripe och Swish Handel:** betallänk och betalning med QR-kod.
- **Visma eAccounting:** eller en tjänst som samlar flera bokföringssystem i ett API.
- **Google Business Profile API:** för att läsa recensionerna (KPI 19). Det kräver en ansökan.
  Recensionslänken som finns i dag behöver inget konto.
- **Microsoft Graph och Google Calendar:** för att synka kalendrarna åt båda hållen.

## Ungefärlig månadskostnad under piloten

Fasta kostnader, med priserna ovan: Supabase Pro med återställning, Vercel Pro, två servrar,
LiveKit på egen server, Mailgun Basic, Sentry gratis och KMS. Det blir **cirka 210 USD och
60 EUR, alltså ungefär 2 900 kr per månad**.

Till det kommer rörliga kostnader per firma: sms, samtalsminuter, Azure och Claude. Specen
räknar med cirka 900 kr per mekaniker och månad under högsäsong.
