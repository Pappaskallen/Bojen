# Firmans telefonnummer i Bojen – guide för portering hos 46elks

För den som sätter upp en pilotfirma. Bojen tar emot firmans samtal och sms genom ett nummer hos
46elks. Receptionisten svarar, kunderna svarar på sms, och om receptionisten inte går att nå kopplas
samtalet till mekanikerns mobil (K10). Guiden går igenom hur firman får ett sådant nummer, hur det
kopplas till Bojen och hur det testas.

> **Kontrollerat 2026-11-18.** 46elks beskriver inte porteringen i sin offentliga dokumentation. De
> skriver att nummer som hyrs via API:t är hyrnummer och att man ska kontakta dem för ett nummer som
> går att portera. Det som står om porteringen nedan är därför de frågor som ska ställas till 46elks
> (help@46elks.com), inte deras villkor. Fyll i svaren här efter första porteringen.

## 1. Välj väg tillsammans med firman

| Firmans nummer i dag | Rekommendation |
| --- | --- |
| Inget särskilt nummer, eller ett nummer som går att byta | **A. Nytt nummer från 46elks.** Klart samma dag. |
| Ett fast nummer eller växelnummer som bara används för firman | **B. Portera numret till 46elks.** Kunderna ringer samma nummer som förut. |
| Mekanikerns egen mobil, som sitter i telefonen | **C. Nytt nummer från 46elks, med vidarekoppling från mobilen under övergången.** Portera inte. |

**Varför inte portera en mobil?** En portering flyttar hela numret. Telefonen slutar då ta emot
samtal och sms på det numret, och mekanikern behöver ett nytt nummer till sin egen telefon. Det
blir sällan rätt för en enmansfirma.

**Väg C i praktiken:**
- Mekanikern vidarekopplar samtal från mobilen till Bojen-numret, helst *vid ej svar och
  upptaget*. Det ställs in hos mobiloperatören eller i telefonens inställningar.
- Sms följer inte med en vidarekoppling. Bojens egna sms skickas från firmans nya nummer, så
  kundernas svar på dem hamnar ändå rätt. Ett sms som en kund skickar till mobilen på eget
  initiativ hamnar däremot i mobilen.
- Firman byter till det nya numret på hemsidan, i signaturen och på bilen, och kan skicka ett
  första utskick om det.
- Viktigt: vidarekopplingen får inte gå tillbaka till samma mobil som är K10-nummer i Bojen. Då
  går samtalet runt i en slinga.

## 2. Väg A eller C: ett nytt nummer

1. Hyr ett svenskt nummer i 46elks konto (på numbers-sidan eller via API:t). Det kostar normalt
   cirka 3 EUR i månaden per nummer enligt 46elks FAQ. Det är ett hyrnummer.
2. Fortsätt med avsnitt 4.

Ett hyrnummer går enligt 46elks inte att portera vidare senare. Om firman vill kunna ta med
numret till en annan operatör en dag, be 46elks om ett porterbart nummer från början.

## 3. Väg B: portera ett befintligt nummer

**Frågor till 46elks innan ni börjar** (skriv in svaren här):

- Vilka nummertyper tar ni emot (fast nummer, 08-nummer, mobilnummer, växelnummer)?
- Vilka handlingar behövs? Vanligtvis en fullmakt som abonnenten skriver under, med samma namn och
  organisations- eller personnummer som hos nuvarande operatör.
- Hur lång tid tar det och vad kostar det, både engångsavgiften och per månad?
- Kan porteringen ske en viss dag och tid, och vad händer med samtal under själva bytet?

**Steg:**

1. Ta reda på vem som står på abonnemanget och vilken operatör numret har i dag. Det står på
   fakturan.
2. Firman skriver under fullmakten. 46elks begär porteringen hos nuvarande operatör.
3. **Säg inte upp det gamla abonnemanget.** Ett avslutat nummer går inte att portera, och
   abonnemanget avslutas av porteringen.
4. Koppla numret till Bojen (avsnitt 4) så fort det syns i 46elks konto, före porteringsdagen
   om 46elks tillåter det. Då fungerar allt från första samtalet.
5. Välj en porteringsdag mitt i veckan och utanför säsongstoppen (inte vid sjösättning eller
   upptagning). Ha mekanikerns mobil som K10-nummer under dagen.
6. Testa enligt avsnitt 5 samma dag som numret har flyttat.

## 4. Koppla numret till Bojen

Det behövs firmans 46elks-nummer i E.164 (till exempel `+46766860010`), numrets id i 46elks och
värdena `APP_URL` och `ELKS_WEBHOOK_SECRET` från produktionsmiljön.

1. **Webhookarna på numret.** Sätt två parametrar på numret:
   - `sms_url` = `{APP_URL}/api/webhooks/elks/sms?token={ELKS_WEBHOOK_SECRET}`
   - `voice_start` = `{APP_URL}/api/webhooks/elks/samtal?token={ELKS_WEBHOOK_SECRET}`

   Via 46elks API (`POST https://api.46elks.com/a1/numbers/{id}`), med kontots användarnamn och
   lösenord. Kör kommandot i ett eget skal, så att token och lösenord inte hamnar i en delad logg:

   ```powershell
   curl.exe -u "$env:ELKS_API_USERNAME`:$env:ELKS_API_PASSWORD" -d "sms_url=$env:APP_URL/api/webhooks/elks/sms?token=$env:ELKS_WEBHOOK_SECRET" -d "voice_start=$env:APP_URL/api/webhooks/elks/samtal?token=$env:ELKS_WEBHOOK_SECRET" https://api.46elks.com/a1/numbers/NUMRETS_ID
   ```

   Leveransrapporter och röstbrevlådan behöver inget på numret. Bojen anger deras adresser själv
   för varje sms och samtal.
2. **Firmans avsändarnummer.** Lägg in numret i firmans inställningar som `settings.sms.from`.
   Bojen hittar firman på det numret när ett sms kommer in, och skickar firmans sms från det.
3. **K10-numret.** Kontrollera att mekanikern som har jour har sitt mobilnummer i Bojen. Dit går
   samtalen när receptionisten inte svarar: först till firmans reservperson om en sådan är vald,
   annars till den första i jourordningen som har ett mobilnummer.
4. **Firmans namn i sms.** Kunden ser numret som avsändare. Svar på Bojens sms kommer tillbaka
   till samma nummer.

## 5. Testa innan firman går över

Gör testerna från en annan mobil än mekanikerns:

- [ ] **Sms in:** skicka "Hej, test" till firmans nummer. Sms:et syns i Bojen.
- [ ] **Svar på en kontroll:** boka en testtid på din mobil. Svara JA på kontrollen dagen innan,
  eller skicka kontrollen manuellt. Besöket blir bekräftat.
- [ ] **Samtal:** ring numret. Receptionisten svarar och samtalet syns under Samtal.
- [ ] **Reservvägen (K10):** stäng av röstagenten, eller låt `VOICE_AGENT_SIP` vara tom i en
  testmiljö. Ring igen. Samtalet går till mekanikerns mobil.
- [ ] **Röstbrevlåda:** låt mekanikern bli uppringd utan att svara. Meddelandet blir en uppgift
  i Bojen.
- [ ] **STOPP:** svara STOPP på ett erbjudande. Kunden får inga fler erbjudanden.
- [ ] **Vidarekoppling (väg C):** ring mekanikerns gamla mobilnummer utan att svara. Samtalet
  hamnar hos receptionisten och går inte runt i en slinga.

## 6. Om något går fel

- **Sms kommer inte fram till Bojen.**
  - Kontrollera `sms_url` och att token är samma som `ELKS_WEBHOOK_SECRET`.
  - I produktion tar Bojen bara emot anrop från 46elks egna IP-adresser. Kontrollera om 46elks
    har bytt adresser (https://46elks.com/docs/ip-addresses).
- **Samtal går rakt till mobilen.**
  - Röstagentens hälsokontroll svarar inte, eller `VOICE_AGENT_SIP` är tom.
  - Det är reservvägen och fungerar som den ska. Laga agenten.
- **Porteringen dröjer.** Behåll den gamla vägen och vidarekoppla från det gamla numret till
  Bojen-numret tills porteringen är klar.
