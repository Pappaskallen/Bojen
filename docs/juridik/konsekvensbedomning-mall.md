# Mall: konsekvensbedömning (DPIA) för en firma som använder Bojen

> **UTKAST 2026-11-18. Ska granskas av jurist** (specifikationen 10.1 räknar med 40 000–60 000 kr
> för granskningen). Firman är personuppgiftsansvarig och gör bedömningen. Bojen har fyllt i det
> som gäller tjänsten. Firman fyller i det som står inom [hakparentes] och går igenom varje risk.

## 1. Behövs en konsekvensbedömning?

Bojen kombinerar flera saker som IMY:s lista räknar som tecken på hög risk:

- inspelning och AI-tolkning av telefonsamtal (ny teknik, systematisk behandling);
- åtkomstinformation till kunders egendom (koder och nyckelplatser), som kan leda till stöld om
  den kommer i fel händer;
- uppgifter om när en båt är obevakad (bokningar, upptagning, sjösättning).

**Slutsats:** en konsekvensbedömning görs. [Datum, ansvarig hos firman.]

## 2. Beskrivning av behandlingen

| | |
| --- | --- |
| Ansvarig | [Firmans namn] |
| Biträde | Bojen AB, enligt personuppgiftsbiträdesavtalet |
| Ändamål | Boka, planera och utföra service på kunders båtar, kommunicera med kunderna, svara i telefon |
| Registrerade | Firmans kunder (cirka [antal]), de som ringer firman, personalen |
| Uppgifter | Se bilaga 1 i personuppgiftsbiträdesavtalet |
| Rättslig grund | Avtal, berättigat intresse (historik, samtal och erbjudanden till befintliga kunder), samtycke (övriga erbjudanden), rättslig förpliktelse (bokföring) |
| Lagringstider | Se bilaga 1 i personuppgiftsbiträdesavtalet |
| Mottagare | Bojens underbiträden, bojen.se/underbitraden |

## 3. Nödvändighet och proportionalitet

- **Samtalsinspelning:**
  - Behövs för att mekanikern ska veta vad kunden ville när ingen kunde svara.
  - Mindre ingripande alternativ: välj läget *bara sammanfattning, ljud vid samtycke*.
  - [Firmans val av läge och varför.]
- **AI-tolkning:** svar som AI:n inte förstår säkert går till en person. Rapporter skickas först
  när mekanikern har godkänt dem.
- **Koder:** behövs för att mekanikern ska komma åt båten när kunden inte är där. Kunden lägger
  in dem själv och kan ta bort dem.
- **Intresseavvägning för samtal och erbjudanden:**
  - Kunden räknar med att firman svarar och minns samtalet. AI:n säger att den är en AI, och
    kunden kan säga nej till inspelning.
  - Erbjudanden går bara till tidigare kunder om liknande tjänster, och kunden kan svara STOPP.
  - [Firmans bedömning.]

## 4. Risker och åtgärder

| Risk | Sannolikhet utan åtgärd | Konsekvens | Åtgärd i Bojen | Kvarstående risk |
| --- | --- | --- | --- | --- |
| Någon får tag på koder och vet när båten är obevakad | Medel | Hög (stöld) | Fältkryptering med nyckel per firma (KMS). Koder visas bara för rätt mekaniker runt besöket, efter upplåsning, och loggas. De skickas aldrig i sms, e-post, loggar eller till AI. | Låg |
| En annan firma ser era kunder | Låg | Hög | Row Level Security i varje tabell, med automatiska tester | Låg |
| Någon lurar AI-receptionisten att lämna ut uppgifter | Medel | Hög | Verktygen kan inte lämna ut koder eller adresser, och manipulationsförsök testas före varje release | Låg |
| AI:n missförstår ett svar och bokar fel | Medel | Låg till medel | Osäkra svar går till en person, och kunden får en bekräftelse som går att ändra | Låg |
| Överföring till USA (Anthropic, Vercel, Supabase och Mailgun som bolag) | – | Medel | Lagring inom EU och standardavtalsklausuler. Koder och adresser skickas aldrig till AI. [Avtal om nolllagring med Anthropic, se README.] | [Bedöm] |
| Samtalsljud sparas längre än nödvändigt | Medel | Medel | Firman väljer 30 eller 90 dagar eller bara sammanfattning, och ljudet raderas automatiskt varje natt när tiden har gått | Låg |
| Personalens telefon kommer bort | Medel | Medel | Kortlivade sessioner som kan spärras. Koder i telefonen raderas efter jobbet eller efter 24 timmar. | Låg |
| Konto tas över | Låg | Hög | Engångskod eller passkey, och tvåfaktorsautentisering för ägare och administratörer | Låg |
| Erbjudanden skickas utan grund | Medel | Medel | Samtycke lagras, STOPP respekteras alltid och kampanjer går till tidigare kunder | Låg |
| Personuppgifter i loggar | Låg | Medel | Felloggar rensas från värden ur databasen | Låg |

## 5. Slutsats och uppföljning

- Kvarstående risk sammantaget: [låg / medel / hög]. Om den är hög: samråd med IMY före start.
- Synpunkter från dataskyddsombud, om firman har ett: [ ]
- Ny bedömning görs när Bojen lägger till en funktion eller ett underbiträde som påverkar
  bedömningen, eller senast [datum om ett år].
- Godkänd av: [namn, datum]
