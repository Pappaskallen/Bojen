# Bojens server

Steg 9 i byggplanen, enligt beslutet 2026-11-21 i `docs/egen-drift.md`. Allt som går att köra
själv ligger på en server hos Hetzner i Helsingfors (AX41). AWS i Stockholm sköter nycklarna
(KMS) och e-posten (SES). 46elks, Azure och Anthropic är kvar som tjänster.

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
| `livekit`, `sip`, `redis`, `voice` | Röstagenten (profilen `voice`, från steg 6.2b) | Media- och SIP-portar |

Supabase Studio, Realtime, Edge Functions och de andra delarna körs inte, eftersom appen inte
använder dem.

## Första uppsättningen

1. **Beställ servern:** Hetzner AX41 med Ubuntu 24.04 och din ssh-nyckel för root.
2. **Beställ en hink för säkerhetskopiorna:** Hetzner Object Storage, i **Falkenstein**. Den
   ligger då i en annan ort än servern, som specen kräver. Skapa en nyckel för hinken.
3. **Lägg in DNS:** A- och AAAA-poster för `bojen.se`, `api.bojen.se` och `fel.bojen.se` till
   servern.
4. **Sätt upp AWS i eu-north-1:**
   - Verifiera domänen i SES.
   - Ta fram SMTP-uppgifter i SES-konsolen.
   - Skapa en IAM-användare som bara får använda KMS-nyckeln och skicka e-post från domänen.
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
9. **Ta den första säkerhetskopian och prova den:**
   ```sh
   sh infra/scripts/backup.sh
   sh infra/scripts/restore-test.sh
   ```
10. **Slå på driftsättningen från GitHub.** Lägg in repots hemligheter `DEPLOY_HOST`,
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

## Inte provat än

Det här är skrivet utan en riktig server och ska kontrolleras vid första uppsättningen:

- **Postgres:** att Supabases Postgres kör med de extra `-c`-flaggorna för arkiveringen, och att
  WAL-G-binären fungerar i avbildningen.
- **Auth:** att Auth läser mejlmallen från Caddy, och att sms- och JWT-krokarna fungerar som
  lokalt.
- **Photon:** att importen klarar `-country-codes se` från Photons planetdump. Annars finns en
  färdig svensk databas, `photon-db-se-latest`, men den är från juli 2025 och kanske inte i
  samma format.
- **LiveKit och SIP:** profilen `voice` är inte provad. Den kopplas in och provas i steg 6.2b,
  och då ska `SIP_CONFIG_BODY` kontrolleras mot LiveKits dokumentation.
