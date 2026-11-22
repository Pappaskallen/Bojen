# Bojens server

Steg 9 i byggplanen, enligt beslutet 2026-11-21 i `docs/egen-drift.md`. Allt som går att köra
själv ligger på en server hos Hetzner i Helsingfors (AX41), även e-posten. AWS i Stockholm
sköter bara nycklarna (KMS). 46elks, Azure och Anthropic är kvar som tjänster.

## Vad som körs

| Tjänst | Vad den gör | Nås utifrån |
|---|---|---|
| `caddy` | TLS med Let's Encrypt och routning | 80 och 443 |
| `web` | Webbappen, bokningssidorna och webhooks | via Caddy, `APP_DOMAIN` |
| `worker` | Graphile Worker: flöden, sms, KPI:er och den nattliga rensningen | nej |
| `db` | Supabases Postgres med PostGIS och WAL-G | nej |
| `auth`, `storage`, `rest` | Supabase Auth och Storage. PostgREST används bara av Storage. | `/auth/v1` och `/storage/v1` via Caddy, `API_DOMAIN` |
| `osrm`, `photon` | Restider och adressökning med OpenStreetMap | nej |
| `glitchtip` | Fel och upptid | via Caddy, `GLITCHTIP_DOMAIN` |
| `stalwart` | E-post: utskick från appen, inkorgar som `dataskydd@bojen.se`, DKIM och skräppostfilter | 25, 465 och 993. Administrationen bara via ssh-tunnel. |
| `livekit`, `sip`, `redis`, `voice` | Röstagenten (profilen `voice`, från steg 6.2b) | Media- och SIP-portar |

Supabase Studio, Realtime, Edge Functions och de andra delarna körs inte, eftersom appen inte
använder dem.

## Första uppsättningen

1. **Beställ servern:** Hetzner AX41 med Ubuntu 24.04 och din ssh-nyckel för root.
2. **Beställ en hink för säkerhetskopiorna:** Hetzner Object Storage, i **Falkenstein**. Den
   ligger då i en annan ort än servern, som specen kräver. Skapa en nyckel för hinken.
3. **Lägg in DNS:**
   - **Webben:** A- och AAAA-poster för `bojen.se`, `api.bojen.se`, `fel.bojen.se` och
     `mail.bojen.se` till servern.
   - **E-posten:**
     - MX för `bojen.se` som pekar på `mail.bojen.se`;
     - SPF: TXT `v=spf1 mx -all` för `bojen.se`;
     - DMARC: TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@bojen.se` för `_dmarc.bojen.se`;
     - DKIM-posten kommer från Stalwart i steg 9.
   - **Omvänd DNS (PTR):** serverns IPv4- och IPv6-adress ska peka på `mail.bojen.se`. Det
     ställs in i Hetzner Robot. Utan omvänd DNS hamnar mejlen i skräpposten.
   - **Port 25:** fråga Hetzner om utgående port 25 är öppen för servern. Vissa leverantörer
     spärrar den tills man ber om det, och utan den kan servern inte leverera mejl.
4. **Sätt upp AWS i eu-north-1:** en KMS-nyckel och en IAM-användare som bara får använda den.
5. **Kör uppsättningen som root:**
   ```sh
   curl -fsSLO https://raw.githubusercontent.com/Pappaskallen/Bojen/main/infra/scripts/setup-server.sh
   sh setup-server.sh "ssh-ed25519 AAAA… bojen-deploy"
   ```
6. **Skapa miljön som användaren `bojen`, i `/srv/bojen`:**
   ```sh
   cp infra/env.example infra/.env      # fyll i domäner, hinken, AWS och tjänsterna
   node infra/scripts/make-secrets.mjs >> infra/.env   # eller med docker run node:24 om node saknas
   ```
   Spara en kopia av `infra/.env` på ett säkert ställe utanför servern. Utan `SMS_OPT_OUT_KEY`,
   `SHORT_LINK_KEY` och `BACKUP_ENCRYPTION_KEY` går STOPP-listan, länkarna och
   säkerhetskopiorna förlorade.
7. **Bygg kartorna en gång.** Båda tar timmar.
   ```sh
   sh infra/scripts/osrm-prepare.sh
   docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm photon /photon/prepare.sh
   ```
8. **Starta:**
   ```sh
   sh infra/scripts/deploy.sh
   ```
9. **Sätt upp e-posten i Stalwart.**
   1. Öppna en tunnel till administrationen och logga in. Det tillfälliga adminlösenordet står i
      loggen.
      ```sh
      ssh -L 8080:127.0.0.1:8080 bojen@<server>      # öppna sedan http://localhost:8080
      docker logs bojen-stalwart-1 2>&1 | grep -A8 'bootstrap mode'
      ```
   2. Lägg till domänen `bojen.se` med servernamnet `mail.bojen.se`. Lägg sedan in den DKIM-post
      som Stalwart visar i DNS.
   3. Lägg till certifikatet från fil:
      - certifikatkedjan:
        `/caddy/caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.bojen.se/mail.bojen.se.crt`;
      - nyckeln: `.../mail.bojen.se.key` i samma mapp.
   4. Skapa kontot `noreply@bojen.se` med lösenordet `SMTP_PASSWORD` från `infra/.env`.
      Skapa också inkorgarna, till exempel `dataskydd@bojen.se`, `dmarc@bojen.se` och en per
      person.
   5. Starta om och prova:
      ```sh
      docker compose -f infra/docker-compose.yml --env-file infra/.env restart stalwart auth worker glitchtip
      ```
      Skicka sedan en inloggningskod till dig själv och kontrollera på
      [mail-tester.com](https://www.mail-tester.com) att SPF, DKIM, DMARC och omvänd DNS
      godkänns.
10. **Sätt upp felrapporteringen i GlitchTip.**
    1. Skapa det första kontot. Registreringen är avstängd, så det görs på servern:
       ```sh
       docker compose -f infra/docker-compose.yml --env-file infra/.env exec glitchtip ./manage.py createsuperuser
       ```
    2. Logga in på `https://fel.bojen.se`. Skapa organisationen *Bojen* och projektet *bojen*
       med plattformen Node.js.
    3. Kopiera projektets DSN och skriv den i `infra/.env` med den interna adressen, så att
       felen inte går ut på nätet: `GLITCHTIP_DSN=http://<nyckel>@glitchtip:8000/<projekt>`.
       Webben och arbetaren skickar till samma projekt, och taggen `service` skiljer dem åt.
    4. Lägg till en upptidsövervakning av `https://bojen.se/` och en avisering till e-post.
    5. Starta om webben och arbetaren:
       ```sh
       docker compose -f infra/docker-compose.yml --env-file infra/.env up -d web worker
       ```
       Det som skickas är bara felets typ, ett tvättat meddelande, stackens funktioner och rader
       och några taggar (tjänst, ruttens mönster, uppgift). Aldrig förfrågan, inloggningen eller
       några värden; se `packages/core/src/logging/errorEvent.ts`.

11. **Ta den första säkerhetskopian och prova den:**
    ```sh
    sh infra/scripts/backup.sh
    sh infra/scripts/restore-test.sh
    ```
12. **Slå på driftsättningen från GitHub.** Lägg in repots hemligheter `DEPLOY_HOST`,
    `DEPLOY_SSH_KEY` (privatnyckeln för `bojen`) och `DEPLOY_KNOWN_HOSTS`, som du får med
    `ssh-keyscan <server>`.

## Varje dag

- **Driftsättning:** sker av sig själv när CI är grönt på `main`
  (`.github/workflows/deploy.yml`). För hand: `sh infra/scripts/deploy.sh [commit]`. Röstdelen
  följer med när `PROFILES="--profile voice"` är satt.
- **Säkerhetskopior:**
  - Postgres arkiverar sin skrivlogg löpande, krypterad, till hinken.
  - En fullständig kopia görs varje natt 01:30 UTC och sparas i 35 dagar.
  - Databasen kan alltså återställas till valfri tidpunkt de senaste 35 dagarna.
  - Status: `systemctl list-timers bojen-backup.timer` och `journalctl -u bojen-backup`.
- **Återställningstest varje kvartal (spec 10.7):**
  `sh infra/scripts/restore-test.sh "2026-12-01 14:00:00+01"`. Det rör inte den databas som
  körs.
- **Uppdateringar:** säkerhetsuppdateringar till Ubuntu installeras av sig själva. Versionerna
  av avbildningarna står i `docker-compose.yml` och ändras i repot.

## Att återställa på riktigt

1. Stoppa `web`, `worker` och `db`.
2. Flytta undan datavolymen.
3. Hämta den fullständiga kopian med `wal-g backup-fetch`, lägg till `recovery.signal` och
   välj tidpunkt, på samma sätt som `restore-test.sh` gör.
4. Starta `db`, vänta tills återställningen är klar och starta sedan resten.

Prova med `restore-test.sh` först.

## Provat lokalt (2026-11-21)

Postgres-avbildningen är byggd och provad i Docker på utvecklingsdatorn, med WAL-G:s
filbackend i stället för Hetzners hink:

- **Arkiveringen** tas emot med de extra `-c`-flaggorna, och skrivloggen arkiveras krypterad.
- **WAL-G** fungerar i avbildningen. Den är byggd på Alpine, så `gcompat` behövs.
- **Rollerna:** init-skriptet sätter deras lösenord, och Auth-rollen loggar in.
- **Fullständig kopia och rensning:** fungerar, så länge de körs som `supabase_admin`.
  `postgres` är inte superanvändare i Supabases Postgres.
- **Återställning till vald tidpunkt:** fungerar. Rader som kom efter tidpunkten var borta.
  Tidpunkten måste ligga före den senast arkiverade skrivloggen.

## Inte provat än

Det här är skrivet utan en riktig server och ska kontrolleras vid första uppsättningen:

- **Hinken:** att WAL-G når Hetzner Object Storage med `AWS_ENDPOINT` och sökvägsadressering.
- **E-posten:**
  - att Stalwart tar certifikatet från Caddys mapp;
  - att Auth, GlitchTip och appen kan skicka genom port 465 under namnet `mail.bojen.se`;
  - att mejlen kommer fram utan att hamna i skräpposten. Kontrollera med mail-tester.com.
- **Auth:** att Auth läser mejlmallen från Caddy, och att sms- och JWT-krokarna fungerar som
  lokalt.
- **Photon:** att importen klarar `-country-codes se` från Photons planetdump. Annars finns en
  färdig svensk databas, `photon-db-se-latest`, men den är från juli 2025 och kanske inte i
  samma format.
- **GlitchTip:** att `createsuperuser` och upptidsövervakningen fungerar i version 6.2.6.
- **LiveKit och SIP:** profilen `voice` är inte provad. Den kopplas in och provas i steg 6.2b,
  och då ska `SIP_CONFIG_BODY` kontrolleras mot LiveKits dokumentation.
