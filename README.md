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
| Konton: Supabase (eu-north-1), 46elks, Azure Speech (Sweden Central), Google Maps Platform, Mailgun EU, Anthropic | Behövs från fas 2–6; tester klarar sig med fejkadaptrar | Före respektive fas |
| Röstprototyp i Vapi för pilotfirmorna | Testa manus och röst tidigt | December |

## Mappar

| Sökväg | Innehåll |
|---|---|
| `CLAUDE.md` | Regler för kodagenten |
| `docs/spec-del1.md` | Specifikation kap. 1–7 |
| `docs/spec-del2.md` | Specifikation kap. 8–16 |
| `docs/byggplan.md` | Stegen med statuslista |
| `docs/changelog.md` | Logg per avslutat steg |
