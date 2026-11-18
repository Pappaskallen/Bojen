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
   - Valet mellan 30 och 90 dagars ljud görs i `tenant.settings.privacy.audioDays`. Det finns
     ingen knapp för det i administrationen ännu.
   - Export av en hel firma när avtalet upphör görs av Bojen på begäran.
2. **Anthropic och lagring.**
   - Specifikationen lovar att inga transkriberingar lagras hos amerikanska underbiträden.
     Samtalstext går till Anthropic för att receptionisten ska kunna svara, och sms-svar,
     anteckningar och bilder på typskyltar går också dit.
   - Löftet kräver ett avtal om nolllagring (Zero Data Retention) med Anthropic. Annars ska
     texterna ange Anthropics lagringstid.
3. **Drift av arbetaren, röstagenten och OSRM.** Var de körs är inte bestämt. Den leverantören
   blir ett underbiträde och ska stå med på listan.
4. **LiveKit.** Om LiveKit Cloud används i steg 6.2b blir LiveKit ett underbiträde för
   samtalsljudet. Om LiveKit körs på egen server blir driftleverantören det.
5. **Bolaget och kontaktadressen.** Bojen AB:s organisationsnummer och adress, och om adressen
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
