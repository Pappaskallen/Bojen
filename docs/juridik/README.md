# Juridik före piloten – utkast

Skrivna 2026-11-18 utifrån specifikationen (kapitel 10 och 13) och det som faktiskt är byggt.
**Inget av detta är granskat av jurist.** Specifikationen räknar med granskning av en jurist
(cirka 40 000–60 000 kr för konsekvensbedömningen).

| Dokument | För vem | Status |
| --- | --- | --- |
| [personuppgiftsbitradesavtal.md](personuppgiftsbitradesavtal.md) | Firman, signeras vid start | Utkast |
| [allmanna-villkor.md](allmanna-villkor.md) | Firman, godkänns vid start | Utkast |
| [integritetspolicy.md](integritetspolicy.md) | Bojens egna kontakter och firmornas personal, på bojen.se/integritet | Utkast |
| [kundinformation-mall.md](kundinformation-mall.md) | Firmans kunder (båtägarna), firman publicerar | Mall |
| [konsekvensbedomning-mall.md](konsekvensbedomning-mall.md) | Firman gör sin DPIA | Mall, förifylld |
| Listan över underbiträden | Publik, på `/underbitraden` i webbappen | Byggd. Texten finns i `legal` i `sv.ts`. |

## Öppna frågor att avgöra före piloten

1. **Automatisk radering och export:** *byggt 2026-11-18 i steg 7.4.* Det som återstår:
   - Valet mellan 30 och 90 dagars ljud görs av ägare och administratörer under Säkerhet
     (byggt 2026-11-19). Det tredje läget i specifikationen 10.5, *ljud bara vid samtycke*, är
     inte byggt: receptionisten frågar inte om samtycke. Kundinformationen ska därför inte
     använda det alternativet ännu.
   - Export av en hel firma när avtalet upphör görs av Bojen på begäran.
2. **Anthropic och lagring.**
   - Specifikationen lovar att inga transkriberingar lagras hos amerikanska underbiträden.
     Samtalstext går till Anthropic för att receptionisten ska kunna svara, och sms-svar,
     anteckningar och bilder på typskyltar går också dit.
   - Löftet kräver ett avtal om nolllagring (Zero Data Retention) med Anthropic. Annars ska
     texterna ange Anthropics lagringstid.
3. **Drift:** *bestämt 2026-11-21.* Allt som går att köra själv ligger på en egen server hos
   Hetzner i Helsingfors (`docs/egen-drift.md`). Hetzner står på listan, och Supabase, Vercel
   och Mailgun är borttagna. E-posten går genom Bojens egen e-postserver på samma server.
4. **LiveKit:** *bestämt 2026-11-21.* LiveKit körs på den egna servern, så samtalsljudet
   stannar hos Hetzner inom EU. Används LiveKit Cloud för testsamtalen i steg 6.2b gäller det
   bara testnummer med påhittade kunder.
5. **Bolaget och kontaktadressen.** InOpSoTech AB:s organisationsnummer och adress, och om adressen
   `dataskydd@bojen.se` ska finnas. Den står på sidan över underbiträden.
6. **Pilotvillkor.** Pris och period för pilotfirmorna, och utlovad tillgänglighet: mål eller
   garanti.
7. **Ansvarsbegränsning** i förhållande till artikel 82 i GDPR, och kostnaden för granskning
   enligt PUB-avtalet.
8. **Utportering av nummer** när en firma slutar: vem betalar 46elks avgift.

## Underhåll

- **Ändrad lista över underbiträden:** uppdatera `legal.subprocessors` i
  `packages/core/src/i18n/sv.ts` och datumet där. Meddela firmorna 30 dagar innan ändringen
  börjar gälla. Ett nytt underbiträde står som *planerat* under den tiden.
- **Ändrad lista över underbiträden i avtalet:** uppdatera även bilaga 3 i PUB-avtalet.
