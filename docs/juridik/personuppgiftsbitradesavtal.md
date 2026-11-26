# Personuppgiftsbiträdesavtal

> **UTKAST 2026-11-18. Ska granskas av jurist innan det används.** Skrivet utifrån specifikationen
> (kapitel 10) och det som är byggt i Bojen. Text inom [hakparentes] fylls i eller avgörs före
> piloten. Se [README.md](README.md) för de öppna frågorna.

Avtalet gäller enligt artikel 28 i dataskyddsförordningen (GDPR) mellan

- **Personuppgiftsansvarig:** firman som använder Bojen enligt Bojens allmänna villkor
  (*Firman*), och
- **Personuppgiftsbiträde:** [InOpSoTech AB, org.nr XXXXXX-XXXX, adress], som tillhandahåller tjänsten Bojen (*Bojen*).

Avtalet är en del av Bojens allmänna villkor och gäller så länge Firman använder tjänsten och
därefter tills Bojen har raderat eller lämnat tillbaka uppgifterna enligt punkt 11.

## 1. Bakgrund och syfte

Firman använder Bojen för att boka, planera och utföra service på kunders båtar: bokningssida,
kundregister, sms och e-post till kunder, kontroll dagen innan, mekanikerns dagvy, servicerapporter,
kampanjer och en AI-receptionist i telefon. Bojen behandlar då personuppgifter för Firmans räkning.
Det här avtalet anger hur.

## 2. Behandlingen

Bilaga 1 beskriver ändamål, kategorier av registrerade och uppgifter, behandlingar och
lagringstider. Bojen behandlar uppgifterna bara för att leverera tjänsten enligt de allmänna
villkoren och Firmans dokumenterade instruktioner. Firmans inställningar i Bojen räknas som
instruktioner, till exempel godkännanderegler, receptionistens regler, kampanjer och val av
inspelningsläge.

Om Bojen anser att en instruktion strider mot dataskyddsreglerna meddelar Bojen Firman utan
dröjsmål. Bojen behöver då inte följa instruktionen förrän Firman har bekräftat eller ändrat den.

Bojen får behandla uppgifterna i anonymiserad och aggregerad form för att förbättra tjänsten och
för statistik, när ingen registrerad eller firma går att identifiera.

## 3. Firmans ansvar

Firman ansvarar för att

- det finns en rättslig grund för behandlingen, till exempel avtal med kunden eller samtycke
  till marknadsföring;
- kunderna får information enligt artiklarna 13 och 14 (en mall finns i
  [kundinformation-mall.md](kundinformation-mall.md));
- uppgifter som läggs in eller importeras är riktiga och har samlats in lagligt, till exempel
  att samtycke till erbjudanden finns när det markeras i importen;
- en konsekvensbedömning görs när den krävs (en mall finns i
  [konsekvensbedomning-mall.md](konsekvensbedomning-mall.md));
- personalens konton används av rätt personer och att konton för den som slutar stängs.

## 4. Sekretess

Bojen ser till att de som har tillgång till uppgifterna har tystnadsplikt, genom avtal eller
lag. Bara de som behöver uppgifterna för att leverera eller ge support på tjänsten får tillgång
till dem.

## 5. Säkerhet

Bojen vidtar de tekniska och organisatoriska åtgärder som anges i bilaga 2. Bojen får ändra
åtgärderna om skyddsnivån inte blir lägre.

## 6. Underbiträden

Firman ger Bojen ett allmänt förhandstillstånd att anlita underbiträden. De som används står i
den publika listan på [https://bojen.app/underbitraden] (bilaga 3).

Bojen meddelar Firman minst **30 dagar** i förväg, via e-post till Firmans ägare, innan ett
underbiträde läggs till eller byts ut. Firman kan invända av sakliga skäl inom den tiden. Om
parterna inte kommer överens får Firman säga upp tjänsten till den dag ändringen börjar gälla,
utan avgift för tiden därefter.

Bojen ingår skriftliga avtal med underbiträdena med samma skyldigheter som i det här avtalet och
ansvarar mot Firman för deras arbete.

## 7. Överföring till tredje land

Uppgifterna lagras inom EU. Några underbiträden är bolag i USA eller behandlar uppgifter där.
Det står i bilaga 3. Överföringen sker då med stöd av EU-kommissionens standardavtalsklausuler,
eller av dataskyddsramverket mellan EU och USA när underbiträdet är certifierat.

[ATT AVGÖRA: Specifikationen lovar att inga ljudfiler eller transkriberingar lagras hos
amerikanska underbiträden. Ljudet går till Azure i Sverige. Text från samtalet skickas däremot
till Anthropic i USA för att receptionisten ska kunna svara. Löftet håller bara om Bojen har ett
avtal om nolllagring (Zero Data Retention) med Anthropic. Annars ska texten ange Anthropics
lagringstid.]

## 8. Hjälp till Firman

Bojen hjälper Firman, så långt det är rimligt, att

- **svara på registrerades begäran** om tillgång, rättelse, radering, begränsning,
  dataportabilitet och invändning. Bojen svarar på Firmans begäran inom **5 arbetsdagar**, så
  att Firman kan hålla lagens frist på en månad. Firmans ägare och administratörer kan själva
  exportera en kunds uppgifter (JSON eller pdf) och radera en kund från kundkortet. Varje export och
  radering loggas.
- göra konsekvensbedömningar och samråd med IMY;
- uppfylla kraven på säkerhet.

Rättelse av kunduppgifter gör Firman själv i kundregistret.

## 9. Personuppgiftsincidenter

Bojen meddelar Firman utan onödigt dröjsmål och senast **24 timmar** efter att Bojen har fått
kännedom om en personuppgiftsincident som rör Firmans uppgifter, så att Firman kan anmäla den
till IMY inom 72 timmar. Meddelandet innehåller det som är känt om

- vad som har hänt och när;
- vilka kategorier och ungefär hur många registrerade och uppgifter som berörs;
- de troliga följderna;
- vad Bojen har gjort och föreslår för att begränsa skadan;
- en kontaktperson hos Bojen.

Det som inte är känt ännu lämnas så fort det är känt.

## 10. Granskning

Bojen ger Firman den information som behövs för att visa att avtalet följs. Firman, eller en
oberoende granskare som Firman anlitar och som har tystnadsplikt, får granska Bojen en gång per
år efter 30 dagars förvarning, eller oftare efter en incident. Granskningen ska störa driften
så lite som möjligt. Firman står för sin egen kostnad. [ATT AVGÖRA: kostnad för Bojens tid vid
granskning.]

## 11. När avtalet upphör

När Firman slutar använda Bojen får Firman en export av sina uppgifter (kunder, båtar, jobb,
rapporter) i ett maskinläsbart format om Firman begär det inom **30 dagar**. Därefter raderar
Bojen uppgifterna inom **90 dagar**. Uppgifter i säkerhetskopior skrivs över inom 35 dagar
efter raderingen.

Koder och åtkomstinformation raderas kryptografiskt: Firmans datanyckel förstörs, så att de
krypterade uppgifterna inte längre går att läsa.

Bojen får behålla uppgifter som lag kräver, till exempel bokföringsunderlag för Bojens egen
fakturering till Firman.

## 12. Ansvar

Ansvarsbegränsningen i de allmänna villkoren gäller, utom när något annat följer av artikel 82
i dataskyddsförordningen. [ATT AVGÖRA med jurist.]

## 13. Ändringar, lag och tvist

Ändringar görs skriftligt, eller av Bojen med 30 dagars förvarning när en ändring krävs av lag
eller myndighet. Svensk lag gäller. Tvister avgörs av allmän domstol med [Stockholms tingsrätt]
som första instans.

---

## Bilaga 1. Beskrivning av behandlingen

**Registrerade:** Firmans kunder och deras kontaktpersoner, de som ringer eller sms:ar Firmans
nummer, de som bokar på Firmans bokningssida, kontaktpersoner hos marinor och klubbar, och Firmans
personal.

**Uppgifter:**

| Kategori | Exempel |
| --- | --- |
| Kontakt | Namn, mobilnummer, e-post, fakturaadress, kundtyp |
| Båt | Märke, modell, årsmodell, registreringsnummer, motor och serienummer, motortimmar, bilder |
| Plats | Marina eller klubb, bryggplats, sommar- och vinterplats, datum för sjösättning och upptagning |
| Åtkomst | Koder till båt, port eller nyckelskåp och var nyckeln finns. Alltid krypterade. |
| Jobb | Bokningar, besök, anteckningar, servicerapporter, delar |
| Kommunikation | Sms och e-post till och från kunden, leveransstatus, svar på kontroller |
| Samtal | Ljud, utskrift och sammanfattning av samtal med receptionisten, röstmeddelanden |
| Samtycken | Samtycke till erbjudanden, avregistreringar (STOPP), lagrade som hash |
| Omdömen | Nöjdhetsbetyg och om länken till recensionen har öppnats |
| Personal | Namn, roll, e-post, mobil, inloggningsfaktorer, logg över vem som visat koder |

Inga känsliga personuppgifter enligt artikel 9 behövs i tjänsten. Firman ska inte lägga in sådana.

**Behandlingar:** lagring, bokning och planering av restider, utskick av sms och e-post,
tolkning av sms-svar med AI, telefonsamtal med AI-receptionist (tal till text, svar och
sammanfattning), utkast till servicerapporter med AI, läsning av typskyltar på bilder,
statistik till Firmans översikt, import från Excel, och export.

**Lagringstider** (specifikationen 10.3):

| Uppgifter | Lagringstid |
| --- | --- |
| Samtalsljud | 90 dagar, eller kortare om Firman väljer det |
| Utskrift och sammanfattning av samtal | 24 månader |
| Förfrågningar som inte blev bokningar | 12 månader |
| Kund, båt och servicehistorik | Under kundrelationen och 36 månader efter senaste jobbet, sedan anonymiseras de |
| Koder och åtkomstinformation | Tills kunden ändrar eller tar bort dem, eller till det slutdatum som har angetts för dem |
| Innehåll i sms och e-post | 24 månader |
| Avregistrerade nummer (STOPP) | Så länge Firman använder Bojen, som hash |
| Revisionslogg | 24 månader |

Rensningen sker automatiskt varje natt. En raderad eller utgången kund anonymiseras: namn, nummer, e-post, adress,
samtycken, meddelandenas innehåll, samtal och koder tas bort, och båtens tekniska historik finns
kvar utan koppling till en person.

## Bilaga 2. Säkerhetsåtgärder

- **Isolering mellan firmor:** Row Level Security på varje tabell, med automatiska tester som
  försöker läsa en annan firmas uppgifter.
- **Kryptering:** TLS i all trafik och kryptering av lagrade data. Koder och åtkomstinformation
  krypteras dessutom per fält med AES-256-GCM och en nyckel per firma, som skyddas av AWS KMS.
- **Koder:** skickas aldrig i sms, e-post, push eller loggar och aldrig till AI:n. De visas bara
  för den mekaniker som har besöket, i ett tidsfönster runt besöket, och varje visning loggas.
- **Inloggning:** engångskod eller passkey. Tvåfaktorsautentisering krävs för ägare och
  administratörer. Sessioner kan spärras.
- **Behörigheter:** ägare, administratör och mekaniker har olika behörigheter.
- **Loggar:** felloggar innehåller inte personuppgifter.
- **Webbsäkerhet:** säkerhetsrubriker och Content Security Policy, skydd mot förfalskade anrop.
- **Leveranskedjan:** beroenden skannas veckovis.
- **AI:** verktygen som AI:n använder kan inte lämna ut koder eller adresser, och data som
  skickas till AI-leverantören används inte för träning.
- **Kontroll:** genomgång mot OWASP ASVS nivå 2 före piloten
  ([sakerhet-asvs.md](../sakerhet-asvs.md)). Penetrationstest före kommersiell lansering.

## Bilaga 3. Underbiträden

Se den publika listan på [https://bojen.app/underbitraden]. Listan vid avtalets början:

| Underbiträde | Uppgift | Var |
| --- | --- | --- |
| Hetzner Online GmbH | Drift av servern: databas, inloggning, filer, webbappen, e-post, röstagenten och kartorna | Helsingfors, Finland |
| Amazon Web Services EMEA SARL | Nyckelhantering (KMS) | Stockholm |
| 46elks AB | Sms och telefoni | Sverige |
| Anthropic PBC | AI för sms, rapporter, typskyltar och receptionisten | USA |
| Microsoft Ireland Operations Ltd | Tal till text och text till tal (planerat) | Sverige |
