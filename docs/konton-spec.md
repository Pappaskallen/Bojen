# Konton som behövs, och alternativen

Skriven 2026-11-23. Ersätter avsnitt 3 och kostnadskalkylen i `konton-och-tjanster.md`, som
fortfarande räknar med Supabase, Vercel, Mailgun och Sentry. Efter beslutet om egen server
(`egen-drift.md`) behövs de inte.

Priserna är exklusive moms och lästa på webben 2026-11-23. Många kommer från jämförelsesidor och
inte från leverantörens egen prissida, och då står det. **Kontrollera alltid priset hos
leverantören innan du väljer plan.** Där ett pris inte gick att få fram står det också.

## Del 1. Kontona

Avtalspart är **InOpSoTech AB**, som tillhandahåller tjänsten Bojen. Kontoadressen är robert@inopsotech.se tills appen har en egen domän.

Kontona står i den ordning de behövs. Skapa dem i InOpSoTech AB:s namn med en adress på bolagets
domän, slå på tvåfaktor och sätt en budgetgräns där det går. Nycklarna läggs i `.env.local` och
som hemligheter i GitHub, aldrig i chatten.

### Steg A: för att bygga klart (låser upp 6.2b, 6.3 och 6.5b)

| # | Konto | Vad det ger | Kostnad för att komma igång | Variabler |
|---|---|---|---|---|
| A1 | **Anthropic** (Claude-plattformen) | Receptionistens modell, tolkning av sms, rapportutkast, typskyltar och testsviten för samtal | Betalas per token. Sätt en månadsgräns, till exempel 200 kr. Begär avtal om nolllagring (ZDR) samtidigt. | `ANTHROPIC_API_KEY` |
| A2 | **Microsoft Azure** med en Speech-resurs i Sweden Central | Tal till text och text till tal på svenska | Gratisnivån F0 (5 timmar tal till text och 0,5 miljoner tecken röst per månad) räcker för testerna. Kräver kreditkort. | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| A3 | **46elks** | Sms, ett testnummer för röstagenten och SIP till LiveKit | 30 kr per månad för numret plus förbrukning | `ELKS_API_USERNAME`, `ELKS_API_PASSWORD` |
| A4 | **LiveKit** | Ljudet i samtalen | Inget konto om LiveKit körs på egen server. Gratisnivån i LiveKit Cloud räcker annars för de första testsamtalen. | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

Testerna i steg A kostar troligen under 500 kr totalt.

### Steg B: det som tar tid att få (skicka nu)

| # | Konto | Varför nu | Kostnad |
|---|---|---|---|
| B1 | **Fortnox utvecklarkonto** och partneransökan | Steg 8 väntar på det. CSV-exporten räcker under tiden. | Att vara utvecklingspartner är gratis. Kunden kan behöva en integrationslicens; uppgifterna går isär (149 kr per månad, eller ingen licens via marknadsplatsen). Fråga Fortnox. |
| B2 | **ZDR-avtal hos Anthropic** | Integritetspolicyn lovar att inga transkriberingar lagras hos amerikanska underbiträden | Inget pris angivet. Det är en förfrågan till Anthropic. |

### Steg C: produktionen inför piloten

| # | Konto | Vad | Kostnad |
|---|---|---|---|
| C1 | **En domän för appen** med DNS du styr. Vald 2026-11-26: **`bojen.app`** (`bojen.se` är upptagen). Köp gärna även `bokabojen.se` och peka den hit. .app kräver https, vilket Caddy redan ger. | Webben, kortlänkarna, e-posten (MX, SPF, DKIM, DMARC) | Några hundra kronor per år |
| C2 | **Hetzner**: servern AX41 och Object Storage | Allt i `infra/` körs där. Säkerhetskopiorna läggs på en annan ort. | AX41 57,30 EUR per månad efter prishöjningen 15 juni 2026, plus IPv4. Object Storage 6,49 EUR per månad. Be om öppen utgående port 25 och omvänd DNS. |
| C3 | **Nyckeltjänst (KMS)** för krypteringen av koder | Huvudnyckeln ligger utanför servern | AWS KMS 1 USD per nyckel och månad och 0,03 USD per 10 000 anrop, med 20 000 anrop gratis. Se alternativet Scaleway i del 2. |
| C4 | **46elks**: ett nummer per pilotfirma, eller porterade nummer | Firmans eget nummer till receptionisten och sms-svaren | 30 kr per nummer och månad. Porteringen kostar "ring oss". |

Behövs inte: Supabase, Vercel, Mailgun, Sentry och LiveKit Cloud. De körs själva på servern:
Supabase, Stalwart för e-posten, GlitchTip, LiveKit, OSRM och Photon.

### Fasta kostnader under piloten

| Post | Per månad |
|---|---|
| Hetzner AX41, IPv4 och Object Storage | cirka 64 EUR |
| KMS | cirka 1 USD |
| 46elks-nummer, testnumret och 3–5 firmor | 120–180 kr |
| Domänen | cirka 20 kr |
| **Summa** | **ungefär 900 kr** (med en euro på cirka 11,5 kr) |

Det är omkring en tredjedel av den gamla kalkylen på 2 500 kr. Till det kommer rörliga kostnader
per firma: sms (0,52 kr per sms-del hos 46elks), samtalsminuter, tal och Claude.

## Del 2. Marknadsundersökning: finns det bättre alternativ?

Varje tjänst vägs på åtta punkter:

- **Kostnad:** vid pilotens volym.
- **Svensk kvalitet:** igenkänning, röst och svenska nummer.
- **Latens:** viktig för röstagenten (målet är p90 under 1,2 s).
- **Dataskydd:** EU-region, och om leverantören är europeisk eller amerikansk.
- **Inlåsning:** hur lätt det är att byta. Alla externa tjänster går genom `packages/adapters`,
  så ett byte är oftast en ny adapter.
- **Driftinsats:** vad vi måste sköta själva.
- **Mognad och support:** om det finns svensk support och dokumentation.
- **Hur lätt kontot är att få:** krav på identitetskontroll och väntetid.

Betyg 1–5, där 5 är bäst. Betyg som bygger på leverantörens egna påståenden är markerade med \*.

### 1. Sms och telefoni (i dag 46elks)

| | 46elks | Twilio | Plivo | Telnyx |
|---|---|---|---|---|
| Sms till Sverige | 0,52 kr | 0,0609 USD (cirka 0,65 kr), inkommande 0,0075 USD | cirka 0,06 USD | Inget svenskt pris hittat |
| Svenska nummer och SIP | Ja, nummer och SIP-trunk | Ja | Ja | Ja, många nummer per SIP-trunk |
| Kostnad | 5 | 3 | 3 | ? |
| Svensk kvalitet och support | 5 (svenskt bolag) | 3 | 3 | 3 |
| Dataskydd | 5 (Sverige) | 2 (USA) | 2 (USA) | 3 |
| Konto | 5 | 3 | 3 | 2 (identitetshandlingar per nummer) |

**Slutsats: behåll 46elks.** Det är billigast av dem med kända priser, svenskt, och har redan
adaptern, webhookarna och leveransrapporterna. Gränsen på 100 sms per minut hanteras med
kampanjtakten. Telnyx eller Twilio är reserver om 46elks skulle få driftproblem. En reserv för
sms kan byggas som en adapter till, men behövs inte för piloten.

### 2. Tal till text (i dag Azure, Sweden Central)

| | Azure | Deepgram Nova-3 | ElevenLabs Scribe v2 Realtime | Soniox | Speechmatics | Mistral Voxtral |
|---|---|---|---|---|---|---|
| Pris i realtid | cirka 1 USD per timme | 0,0048 USD per minut (cirka 0,29 USD per timme), angett som tidsbegränsat | 0,39 USD per timme | 0,12 USD per timme | cirka 0,54 USD per timme enligt en jämförelse | Oklart |
| Kostnad | 2 | 4 | 4 | 5 | 4 | ? |
| Svenska | 4 | 3 (13,8 % fel för den äldre Nova-2 i en mätning) | 4\* | 5\* | 4\* | ? |
| Dataskydd | 5 (Sweden Central) | 2 | 3 | ? | 4 | 5\* (EU) |
| Inlåsning | Låg | Låg | Låg | Låg | Låg | Låg |

Mätningarna av fel per ord kommer från leverantörerna själva och motsäger varandra. Speechmatics
mätning gav Azure 13,1 % fel på svenska, och Soniox påstår att Soniox har 1,25 % och ElevenLabs
3,16 %. Ingen av dem är oberoende.

**Slutsats: behåll Azure för piloten, men gör en jämförelse med egna inspelningar.**
- Azure är dyrast, men är den enda med bekräftad drift i Sverige. Ordlistan för båttermer
  (DPH, drev, impeller) är redan planerad, och avtalet ingår i Microsofts PUB-villkor.
- Med specens 300 röstminuter per firma och månad blir skillnaden mellan Azure och Soniox under
  50 kr per firma och månad.
- Jämför Azure, Soniox och ElevenLabs med 20 riktiga samtal med båttermer innan piloten, när
  röstagenten finns. Om en annan är tydligt bättre på svenska och kan behandla datan inom EU, är
  det värt en ny adapter.

### 3. Text till tal (i dag Azure neural sv-SE)

| | Azure | ElevenLabs | Cartesia | Soniox |
|---|---|---|---|---|
| Pris | Gick inte att läsa (prissidan visar inga belopp). 0,5 miljoner tecken gratis per månad. | Planer med krediter, Scale 330 USD per månad. En jämförelse uppskattar 100–300 USD per miljon tecken. | Inget pris hittat | Inget pris hittat |
| Svensk röst | 4 | 5\* | 4\* (etta i Speech Arena enligt Cartesia) | ? |
| Latens | 4 | 4 (Flash v2.5) | 5\* | 5\* |
| Dataskydd | 5 | 3 | 3 | ? |

**Slutsats: behåll Azure.** Det ger låg kostnad, drift i Sverige och samma konto som tal till
text. ElevenLabs har troligen den mest naturliga svenska rösten, men kostar flera gånger mer. Det
kan bli ett tillval för egen röst (R10, prioritet K) senare.

### 4. Språkmodellen (i dag Claude Haiku 5.5 och Sonnet 5.5)

- **Haiku 5.5 kostar 0,10 USD per miljon tokens in och 0,50 USD ut,** enligt flera
  prisjämförelser (Anthropics egen prissida är inte läst). Ett samtal kostar då bara några öre i
  modellanrop.
- **Mistral** erbjuder behandling inom EU och egna röstmodeller (Voxtral). Uppgifterna om pris
  och latens kommer från andra än Mistral själva och är inte bekräftade.
- **Projektets regel** (CLAUDE.md) är Claude med det officiella SDK:t, och prompten,
  testsviten och verktygen är byggda för det.

**Slutsats: behåll Claude.** Den svaga punkten är dataskyddet, att Anthropic är ett amerikanskt
underbiträde, och den löses med ZDR-avtalet (B2). Fråga också Anthropic om databehandling inom
EU. Byt bara om ZDR inte går att få och löftet i integritetspolicyn måste hållas.

### 5. Plattformen för röstagenten (i dag LiveKit Agents på egen server)

| | LiveKit på egen server | LiveKit Cloud | Pipecat | Vapi | Retell |
|---|---|---|---|---|---|
| Pris per minut | 0 kr (ingår i servern) | 0,01 USD per agentminut, och SIP-minuter ingår upp till en gräns | Ramverket gratis, Pipecat Cloud från 0,01 USD | 0,05 USD för plattformen, 0,23–0,33 USD med egna modeller enligt en jämförelse | 0,07–0,31 USD |
| Kostnad | 5 | 4 | 5 | 2 | 2 |
| Kontroll över säkerhetsreglerna | 5 | 5 | 5 | 2 | 2 |
| Dataskydd | 5 (vår server) | 3 | 4 | 2 (USA) | 2 (USA) |
| Driftinsats | 2 | 4 | 3 | 5 | 5 |

**Slutsats: behåll LiveKit på egen server.** Vapi och Retell är enklast att komma igång med, men
kostar 5–30 gånger mer per minut. De lägger dessutom samtalsflödet hos en amerikansk plattform,
och reglerna om koder, kontrollfrågan och 112 måste då litas på hos dem. Pipecat är ett
likvärdigt ramverk, men koden är redan skriven för LiveKit.

### 6. Servern (i dag Hetzner AX41 i Helsingfors)

| | Hetzner AX41 | UpCloud (Stockholm) | GleSYS (Sverige) | Elastx (Sverige) |
|---|---|---|---|---|
| Pris | 57,30 EUR per månad för en dedikerad server med 64 GB RAM | Virtuella servrar från 3 EUR per månad. Pris för en motsvarande server är inte läst. | KVM med 2 vCPU och 2 GB RAM cirka 27 EUR per månad. VMware med 6 vCPU och 16 GB RAM cirka 269 EUR per månad. | En liten virtuell server cirka 26 USD per månad enligt en jämförelse |
| Kostnad för 64 GB RAM | 5 | 3? | 1 | 1 |
| Drift i Sverige | 2 (Finland) | 5 | 5 | 5 |
| Dataskydd | 4 (EU, tyskt bolag) | 5 (EU, finskt bolag) | 5 (svenskt bolag) | 5 (svenskt bolag, tre zoner) |
| Driftinsats | 2 (vi sköter allt) | 3 | 3 | 4 |

Kartorna (OSRM och Photon med hela Sverige) och Supabase behöver mycket minne. En dedikerad server
med 64 GB hos Hetzner kostar en bråkdel av samma minne som virtuella servrar hos de svenska
leverantörerna. Hetzner höjde priserna två gånger under 2026, så kontrollera priset när du
beställer.

**Slutsats: Hetzner för piloten.** Om "data i Sverige" blir ett säljargument mot marinor och
klubbar är **UpCloud i Stockholm** det bästa alternativet. Be om en offert på 8 vCPU och 32–64 GB
RAM innan beslutet. Flytten är enkel, eftersom allt ligger i Docker Compose (`infra/`).

### 7. Nyckeltjänsten (i dag AWS KMS i Stockholm)

| | AWS KMS | Scaleway Key Manager | OpenBao på egen server |
|---|---|---|---|
| Pris | 1 USD per nyckel och månad och 0,03 USD per 10 000 anrop, 20 000 anrop gratis | 0,04–0,06 EUR per nyckelversion och månad (sidorna går isär) och 0,03 EUR per 10 000 anrop | 0 kr |
| Dataskydd | 3 (EU-region, men amerikanskt bolag) | 5 (franskt bolag, bara europeiska datacenter) | 4 |
| Säkerhet | 5 | 4 (bara AES-256-GCM, vilket räcker för oss) | 2 (nyckeln ligger på samma server som datan) |
| Inlåsning och byte | Adaptern finns | Kräver en ny adapter (liten) | Kräver en ny adapter |

**Slutsats: AWS fungerar, men Scaleway är värt att överväga.** Då ligger alla underbiträden för
lagring och nycklar hos europeiska bolag, och AWS-kontot behövs inte. Kostnaden blir i praktiken
noll för båda. Scaleway kräver en ny KMS-adapter och ett nytt test. **Ditt beslut.** OpenBao på
samma server avråder jag från, eftersom huvudnyckeln då inte skyddar mot ett intrång på servern.

### 8. Bokföring (i dag Fortnox, CSV under tiden)

| | Fortnox | Spiris (tidigare Visma eEkonomi) | Bokio |
|---|---|---|---|
| Andel av målgruppen | Störst (spec A13) | Näst störst | Inte undersökt |
| Utvecklaravtal | Gratis. Ansökan och publicering via utvecklarportalen. | Sandlåda direkt. Produktion beviljas av Spiris support på begäran. | Inget hittat om öppet API |
| Kostnad för kunden | Kanske en integrationslicens på 149 kr per månad, se B1 | Inte hittat | ? |

**Slutsats: Fortnox först, som planerat. Spiris i version 2.** CSV-exporten fungerar för båda
under tiden.

### 9. E-post och felrapportering (i dag Stalwart och GlitchTip på egen server)

Båda kostar 0 kr och håller datan på vår server. Ett utskick via en tjänst som Mailgun EU
(15 USD per månad, enligt den gamla kalkylen) blir aktuellt först om leveransen till inkorgarna
krånglar. Det är adaptern `packages/adapters/src/email` som byts i så fall.

### 10. VoiceStudio i stället för Azure? (undersökt 2026-11-23)

Robert har [VoiceStudio](https://github.com/debpalash/VoiceStudio) 0.5.7 installerat. Det är ett
skrivbordsprogram med öppen källkod (AGPL-3.0) för tal till text, text till tal och röstkloning
helt lokalt, med motorer som WhisperX, Faster-Whisper, OmniVoice och CosyVoice. Det har ett lokalt
API på port 3900, med strömmande tal över websocket (`/ws/tts`) och transkribering
(`/v1/audio/transcriptions`).

| Punkt | Bedömning |
|---|---|
| Kostnad | 5: gratis, bortsett från hårdvaran |
| Licens för vår användning | **1.** Standardmodellen för röst, OmniVoice, är icke-kommersiell (CC-BY-NC). Enligt projektets egen förteckning är ingen modell godkänd för kommersiellt bruk än. Den kommersiella licensen finns i den betalda VoiceStudio Pro. |
| Svenska | ?: "646 språk" utlovas, men ingen lista per motor. Whisper-motorerna (tal till text) klarar svenska. Rösterna är okända. |
| Latens i telefonsamtal | **1 på vår hårdvara.** Mätningarna är gjorda på en Apple M2. Utan GPU är det ungefär hälften så snabbt som M2, och ännu långsammare jämfört med NVIDIA. GPU-stöd på Windows kräver NVIDIA. Din dator har en AMD Vega 8 och 4 kärnor, och Hetzner AX41 har ingen GPU. Ett svar under 1,2 sekunder (p90) är inte realistiskt. |
| Drift | 2: ett skrivbordsprogram (Electron), inte en servertjänst. Att köra det på servern är inte det projektet är byggt för. |
| Dataskydd | 5: allt stannar lokalt |
| Mognad | 3: stort och aktivt projekt, men version 0.x och snabba förändringar |

**Slutsats: inte för röstagenten i piloten.**
- Licensen stoppar standardrösten i en kommersiell tjänst.
- Utan GPU blir svaren för långsamma för ett telefonsamtal.
- Det är byggt för en dator, inte för en server som tar emot samtal dygnet runt.

**Där det kan vara till nytta redan nu:**
- **Testljud vid din egen dator.** Läs in eller generera svenska meningar med båttermer för
  jämförelsetestet av tal till text (punkt 2). Använd då en motor vars licens tillåter det, eller
  din egen röst, och bara som testdata.
- **Tal till text i efterhand.** Whisper (MIT-licens) går att köra på servern för
  röstanteckningar och inspelningar där svaret inte behöver komma direkt. Det kräver ingen
  VoiceStudio, och vi kan pröva det om Azure-kostnaden blir ett problem. Svenskt finjusterade
  Whisper-modeller från KB-labbet är värda att testa. Kontrollera licensen först.
- **Om en GPU-server blir aktuell senare** (till exempel en Hetzner GEX med NVIDIA) och en motor
  med kommersiell licens och bra svenska finns, kan frågan prövas igen. Då som en ny adapter för
  tal, och med samma jämförelsetest.

## Del 3. Sammanfattning

| Tjänst | Förslag | Ändring mot i dag |
|---|---|---|
| Sms och telefoni | 46elks | Ingen |
| Tal till text | Azure, med ett jämförelsetest mot Soniox och ElevenLabs före piloten | Ett test |
| Text till tal | Azure | Ingen |
| Språkmodell | Claude, med ZDR-avtal | Ingen |
| Röstplattform | LiveKit på egen server | Ingen |
| Server | Hetzner AX41. UpCloud Stockholm om data i Sverige blir ett krav. | Ingen, men be om en offert |
| Nycklar | AWS KMS eller Scaleway Key Manager | **Ditt val**, Scaleway kräver en ny adapter |
| Bokföring | Fortnox, CSV under tiden | Ingen |
| E-post och fel | Egen server | Ingen |

**Beslut som väntar på dig:**
1. AWS KMS eller Scaleway Key Manager.
2. Om data i Sverige ska vara ett löfte. Då blir det UpCloud i stället för Hetzner.
3. Vilka konton i steg A du vill skapa först. Anthropic och Azure F0 räcker för att börja testa
   röstagenten mot riktiga tjänster.

## Källor

- 46elks: [Send SMS](https://46elks.com/docs/send-sms) och prislistan i `konton-och-tjanster.md`
- Sms: [Twilio Sverige](https://www.twilio.com/en-us/sms/pricing/se), [Plivo Sverige](https://www.plivo.com/sms/pricing/se/), [Sent.dm](https://sent.dm/en/resources/sms-pricing/sweden-sms-pricing), [Telnyx nummerkrav](https://support.telnyx.com/en/articles/1311477-sweden-did-requirements)
- Tal till text: [Deepgram svenska](https://deepgram.com/product/speech-to-text/swedish), [Speechmatics svenska](https://www.speechmatics.com/speech-to-text/swedish), [Soniox prisjämförelse](https://soniox.com/compare/stt/pricing), [Soniox mot Azure](https://soniox.com/compare-stt/soniox-vs-azure/swedish), [Azure Speech-priser](https://azure.microsoft.com/sv-se/pricing/details/speech/)
- Text till tal: [ElevenLabs API-priser](https://elevenlabs.io/sv/pricing/api), [Cartesia svenska](https://cartesia.ai/languages/swedish), [Speechify kostnadsjämförelse](https://speechify.com/sv/blog/evaluating-cost-text-to-speech-apis/)
- Röstplattformar: [LiveKit: Retell mot Vapi mot LiveKit](https://livekit.com/blog/retell-vs-vapi-vs-livekit), [Particula-jämförelse](https://particula.tech/blog/vapi-vs-retell-vs-livekit-vs-pipecat-voice-agent-platform), [Plivo om prismodeller](https://www.plivo.com/blog/voice-ai-agent-pricing-models-bundled-vs-unbundled-costs/)
- Språkmodell: [Price Per Token, Haiku 5.5](https://pricepertoken.com/pricing-page/model/anthropic-claude-haiku-5.5), [The Decoder om Mistral i EU](https://the-decoder.com/mistral-now-offers-eu-data-processing-and-priority-access-but-both-come-with-important-limits/)
- Server: [Hetzners prisjustering](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [Elastx mot UpCloud](https://getdeploying.com/elastx-vs-upcloud), [UpCloud VPS](https://upcloud.com/vps-hosting/), [GleSYS-planer](https://www.whtop.com/plans/glesys.com/35242)
- Nycklar: [AWS KMS-priser](https://aws.amazon.com/kms/pricing/), [Scaleway Key Manager](https://www.scaleway.com/en/key-manager/), [Scaleway FAQ](https://www.scaleway.com/en/docs/key-manager/faq/)
- Bokföring: [Fortnox integrationspartner](https://www.fortnox.se/om-fortnox/partners/integrationspartner), [Fortnox utvecklare](https://www.fortnox.se/developer), [Apideck om Spiris API](https://www.apideck.com/blog/spiris-visma-eaccounting-api-integration)
