# Utkast: första kontakten med Fortnox

Skrivet 2026-11-23 inför steg 8. **Inget är skickat.** Robert fyller i det som står inom
hakparentes, läser igenom och skickar själv.

Så går det till enligt Fortnox webbplats
([integrationspartner](https://www.fortnox.se/om-fortnox/partners/integrationspartner),
[utvecklare](https://www.fortnox.se/developer)):

1. Godkänn utvecklaravtalet, skapa ett konto och registrera Bojen som utvecklare i
   utvecklarportalen. Det är gratis och görs själv på webben.
2. Skapa appen i portalen med texterna i avsnitt B nedan. Det ger `FORTNOX_CLIENT_ID` och
   `FORTNOX_CLIENT_SECRET`, som läggs i `.env.local`.
3. Skicka mejlet i avsnitt A till Fortnox partnerteam för det som portalen inte svarar på: licens,
   testföretag och publicering. Adressen står i utvecklarportalen.
4. När integrationen är byggd och provad i testföretaget begär du publicering i portalen och
   bockar av deras checklista.

## A. Mejl till Fortnox partnerteam

**Ämne:** Bojen från InOpSoTech AB – ny integration för båtmekaniker (faktura och betalstatus)

Hej,

Jag heter [förnamn efternamn] och driver InOpSoTech AB ([organisationsnummer]). Vi bygger Bojen, ett
system för bokning, kundregister och kundkontakt för båtmekaniker som åker ut till kunderna,
med start i Stockholms skärgård. Pilotsäsongen börjar 1 mars 2027 med 3–5 firmor, och de flesta
av dem bokför i Fortnox.

Vi har registrerat oss som utvecklare och vill bygga en integration som:

- skapar och uppdaterar kunder i Fortnox utifrån Bojens kundregister;
- använder firmans artiklar för arbete, framkörning, akuttillägg och reservdelar;
- skapar en faktura från mekanikerns godkända fakturaunderlag efter jobbet (privatkunder får
  normalt 10 dagars betalningstid);
- hämtar betalstatus, så att jobbet flyttas till Betalt i Bojen.

Kopplingen görs med OAuth 2 av firmans ägare. Bojen läser och skriver bara det som behövs för
detta, och åtkomsttoken lagras krypterad.

Vi har några frågor innan vi bygger klart:

1. **Licens för kunden.** Behöver firman en integrationslicens hos Fortnox för att använda
   kopplingen, och vad kostar den? Ändras det om integrationen säljs via er marknadsplats?
2. **Testföretag.** Kan vi få ett testföretag eller en sandlåda att prova mot, så att vi inte
   behöver använda en pilotfirmas riktiga bokföring?
3. **Behörigheter.** Vi räknar med behörigheterna för kunder, artiklar, fakturor, betalningar och
   företagsinformation. Stämmer det för det vi beskriver ovan, och finns det något vi bör tänka
   på?
4. **Betalstatus.** Rekommenderar ni att vi frågar efter betalstatus med jämna mellanrum, eller
   finns det ett sätt att få besked när en faktura är betald?
5. **Publicering.** Hur lång tid brukar granskningen inför publicering i marknadsplatsen ta, och
   vad kontrollerar ni? Vi vill gärna vara publicerade innan piloten börjar 1 mars 2027.
6. **Försäljning via Fortnox.** Vi är intresserade av att låta Fortnox sälja och fakturera
   integrationen. Vilka villkor gäller?
7. **Gränser.** Hur många anrop per minut tillåter API:et per kopplad firma?

Om något är enklare att ta på ett kort samtal går det bra. Ni når mig på [telefonnummer] eller
[e-post].

Vänliga hälsningar
[förnamn efternamn]
InOpSoTech AB
[webbplats]

## B. Texter till appen i utvecklarportalen

**Namn:** Bojen

**Kort beskrivning (en mening):**
Fakturan skapas i Fortnox direkt när båtmekanikern har godkänt jobbet, och betalningen syns i
Bojen.

**Beskrivning:**
Bojen är bokningssystemet för båtmekaniker som åker ut till båten. När jobbet är klart godkänner
mekanikern fakturaunderlaget i mobilen: arbete, framkörning, akuttillägg och delar. Med
kopplingen till Fortnox blir underlaget en faktura till kunden, med kunden och artiklarna från
Fortnox. När kunden har betalat flyttas jobbet till Betalt i Bojen, så att du ser vad som är
obetalt utan att jämföra två system.

- Kunder skapas och uppdateras i Fortnox från Bojen.
- Fakturan använder dina egna artiklar och priser.
- Betalstatusen hämtas tillbaka automatiskt.
- Du kopplar ihop kontona med ett klick. Ingen data delas med andra.

**Kategori:** Fakturering (eller närmaste kategori i portalen)

**Webbplats:** [https://bojen.se]

**Support:** [support@bojen.se]

**Integritetspolicy:** [https://bojen.se/integritet]. Den finns som utkast i
`docs/juridik/integritetspolicy.md` och ska publiceras först.

**Omdirigeringsadress (OAuth):** `https://[domän]/api/integrationer/fortnox/callback`. Adressen
bestäms i steg 8. Lägg till den lokala adressen för utveckling om portalen tillåter det.

## Innan du skickar

- [ ] InOpSoTech AB:s organisationsnummer är ifyllt.
- [ ] Adresserna på bolagets domän finns (support och avsändare).
- [ ] Integritetspolicyn är publicerad, eller så nämns den som kommande.
- [ ] Svaren läggs in i `docs/konton-spec.md` under B1, och licensfrågan förs vidare till
  prismodellen i spec 13.3 om firman får en extra kostnad.
