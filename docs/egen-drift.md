# Egen drift: vad som går att köra själv, och vad det sparar

Sammanställt 2026-11-21 som ett komplement till `docs/konton-och-tjanster.md`. Priserna är lästa
på leverantörernas sidor samma dag, exklusive moms. Där en siffra är min egen uträkning står det.

**Kort svar:** de fasta kostnaderna kan gå från cirka 2 500 kr till cirka 750 kr per månad om
nästan allt körs på en egen hyrd server. Tal till text, text till tal, språkmodellen och
telefonin lönar sig inte att köra själv i pilotens skala. Att flytta dit är dyrare, sämre eller
omöjligt.

## Var pengarna går i dag

Enligt `docs/konton-och-tjanster.md`:

- **Fasta kostnader:** de styrda plattformarna Supabase, Vercel, LiveKit, Mailgun och Sentry.
  Återställning till valfri tidpunkt i Supabase är den största enskilda posten, 100 USD per
  månad.
- **Rörliga kostnader:** sms, samtalsminuter, Azure och Claude. De följer antalet besök och
  samtal och är små under piloten.

## Tjänst för tjänst

| Tjänst | Kan köras själv? | Ersättning | Sparar per månad | Vad det kostar i stället |
|---|---|---|---|---|
| **Supabase** (databas, inloggning, filer) | Ja | Supabase självhostad med Docker Compose på egen server. Återställning till valfri tidpunkt med WAL-G till Hetzner Object Storage (6,49 EUR per månad, 1 TB). | 25 USD + 100 USD | Vi ansvarar själva för säkerhetskopior, uppdateringar, säkerhet och övervakning. Det står uttryckligen i Supabases dokumentation. Det vi använder i dag fungerar likadant självhostat, eftersom det är samma som lokalt med `supabase start`: inloggningen med JWT- och sms-krokarna, och lagringen av filer. |
| **Vercel** (webbappen) | Ja | `next start` på servern bakom Caddy, som sköter TLS-certifikaten. Driftsättning från GitHub Actions. | 20 USD | Vi förlorar förhandsversioner per gren, CDN och automatisk driftsättning utan avbrott. Driftsättningen behöver ett eget skript. |
| **LiveKit** | Ja | LiveKit-servern på egen server. Den behöver ett domännamn med riktigt certifikat, UDP-portarna 50000–60000, TURN och Redis. | 0–50 USD | Mer att sköta själva. Fördelen är att samtalsljudet stannar i vår drift inom EU (juridik, öppen fråga 4). |
| **Sentry** | Ja | GlitchTip, som är byggt för Sentrys SDK:er och behöver cirka 512 MB RAM och Postgres. Det andra alternativet är Sentrys gratisnivå. | 0 kr (gratisnivån räcker under piloten) | Felrapporterna stannar på vår server. Det är ett argument för integriteten, inte för pengarna. |
| **Mailgun** | Bättre att byta tjänst än att köra själv | Amazon SES i eu-north-1: 0,10 USD per 1 000 mejl. AWS-kontot behövs ändå för KMS. | Cirka 15 USD | En ny adapter i `packages/adapters`, cirka en halv dag. En egen e-postserver avråder jag från, eftersom mejlen ofta hamnar i skräpposten. |
| **AWS KMS** | Ja, men det är fel ställe att spara | OpenBao eller Vault på egen server, eller bara en huvudnyckel i miljön. | 1 USD | Det försvagar skyddet av koderna. Specen kräver att koderna inte går att läsa ur en säkerhetskopia utan KMS. **Behåll.** |
| **OSRM och Photon** | Redan planerade för egen drift | – | – | – |
| **Azure Speech** (tal till text och text till tal) | Tekniskt ja | KB-Whisper för tal till text. Det är Kungliga bibliotekets svenska Whisper, med Apache 2.0-licens och klart lägre felfrekvens än OpenAI:s Whisper på svenska enligt KBLab. Piper för text till tal, som har två svenska röster av mellankvalitet; repot är arkiverat och arbetet har flyttat. | Inget under piloten | Realtid kräver en GPU-server, till exempel Hetzner GEX45: 214 EUR per månad och 209 EUR i startavgift. Det är mer än Azure kostar vid pilotens volym. Whisper strömmar inte, så målet om svarstid under 1,2 s blir svårt att nå. Pipers röster låter tydligt syntetiska jämfört med Azures neurala röster. **Behåll Azure.** |
| **Claude** | Tekniskt ja, men inte på samma nivå | En öppen modell på en stor GPU, till exempel GEX63 för 999 EUR per månad. | Inget | Kraven är 0 regelbrott (koder, priser och 112), verktygsanrop som håller och bra svenska. Där ligger öppna modeller under Claude, och CLAUDE.md anger Claude. Kostnaden per samtal är liten. **Behåll.** |
| **46elks** | Nej | Telefoni och sms kräver en operatör. | – | Det som går att göra är att skicka färre sms: webbpush till personalen (finns redan), e-post när kunden föredrar det och kortare texter, så att färre sms-delar går åt. |

## Förslag: en server för allt som går att köra själv

Hetzner **AX41**, en dedikerad server i Helsingfors:

- **Pris:** 59 EUR per månad, utan startavgift.
- **Hårdvara:** troligen Ryzen 5 3600, 64 GB RAM och 2 × 512 GB NVMe. Hetzners sida ordnar
  specifikationerna i samma följd som modellerna, men kopplar dem inte uttryckligen ihop.
  Kontrollera vid beställningen.

Servern kör Supabase, webbappen, arbetaren, röstagenten, LiveKit, OSRM och Photon med
Sverigekartan, och GlitchTip. Min uppskattning är 10–14 GB RAM totalt, så 64 GB ger gott om
marginal.

Ett molnalternativ är **CPX42**: 8 vCPU, 16 GB RAM, 320 GB, 59,49 EUR per månad. Där finns
ögonblicksbilder och servern går att byta storlek på, men minnet blir trångt. Hetzners sida
visade dessutom i dag att Helsingfors tillfälligt inte gick att beställa.

| Post | Per månad |
|---|---|
| Hetzner AX41 | 59 EUR |
| Hetzner Object Storage för WAL-G-arkivet och säkerhetskopiorna | 6,49 EUR |
| AWS KMS | Cirka 1 USD |
| Amazon SES | Några kronor vid pilotens volym |
| Sentry gratis, eller GlitchTip på servern | 0 kr |
| **Summa** | **Cirka 66 EUR, ungefär 750 kr** (min uträkning) |

Jämfört med cirka 2 500 kr per månad med de styrda tjänsterna sparar det **cirka 1 750 kr per
månad, ungefär 21 000 kr per år**. De rörliga kostnaderna (46elks, Azure och Claude) är
desamma i båda fallen.

## Vad det kostar i stället

- **Arbete:**
  - **Bygget:** cirka 3–4 dagar för servern, Docker Compose, Caddy, WAL-G, driftsättningen från
    GitHub och SES-adaptern.
  - **Löpande:** några timmar i månaden för uppdateringar, övervakning och ett återställningstest
    per kvartal, som specen kräver.
- **En enda server är en enda felpunkt.**
  - Samtalen klarar sig: reservrutinen K10 skickar dem till mekanikerns mobil när röstagenten
    inte svarar.
  - Bokningssidan och administrationen ligger nere tills servern är tillbaka.
  - En dedikerad server har ingen ögonblicksbild. Därför måste WAL-G-arkivet och ett
    återställningstest finnas från dag ett.
- **Färre amerikanska underbiträden.** Supabase Inc. och Vercel Inc. försvinner från listan, och
  Hetzner (Tyskland) tillkommer. Det förenklar juridiken.

## Att köra hemma på egen dator

Det fungerar bra för utveckling och test, och det gör vi redan med Docker och Supabase lokalt.
För produktion avråder jag:

- **Uppkopplingen:** en hemmaanslutning har sällan fast IP-adress. LiveKit behöver öppna
  UDP-portar, och elavbrott och router-strul blir driftavbrott.
- **Personuppgifterna:** de ska ligga i en driftmiljö med fysisk säkerhet, och det står i
  PUB-avtalet.
- **Datorn:** den här datorn har 5 GB RAM, vilket inte räcker för OSRM, Photon och Supabase
  samtidigt.

## Mellanväg

Om du vill komma igång snabbt men ändå spara:
- **Behåll Supabase Pro** (25 USD), men skippa tillägget för återställning till valfri tidpunkt
  under piloten. Det sparar 100 USD. Vilka säkerhetskopior som ingår i Pro har jag inte kunnat
  kontrollera.
- **Kör resten själv:** webbappen, LiveKit, kartorna och GlitchTip på en server.
- **Byt Mailgun mot SES.**

Det blir ungefär 25 USD + 59 EUR + några kronor, alltså cirka 950 kr per månad (min uträkning).

## Beslut 2026-11-21

Robert valde **en egen server**: AX41, självhostad Supabase, webbappen och LiveKit på servern, och GlitchTip. Samma dag bestämde han att **även e-posten ska ligga på servern**, både utskicken och inkorgarna, i stället för SES. Den körs med Stalwart. Risken är att mejlen oftare hamnar i skräpposten, så SPF, DKIM, DMARC och omvänd DNS är krav, och utgående port 25 måste vara öppen hos Hetzner. Bygget är steg 9 i byggplanen och finns i `infra/`.

## Besluten som behövdes

Allt utom KMS, Azure, Claude och 46elks är avvikelser från MVP-stacken i byggplanen. Jag byter
inte stack utan ditt ja. Det som ska bestämmas:

1. **Supabase:** självhostad eller Pro.
2. **Webbappen:** på egen server eller på Vercel.
3. **LiveKit:** på egen server eller i LiveKit Cloud.
4. **E-post:** Amazon SES eller Mailgun.
5. **Felövervakning:** GlitchTip eller Sentrys gratisnivå.
6. **Servern:** AX41 (dedikerad, mest minne) eller CPX42 (moln, ögonblicksbilder).

När du har bestämt dig uppdaterar jag byggplanen och listan över underbiträden och lägger in
drifttekniken som ett eget steg.
