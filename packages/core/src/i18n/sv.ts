/**
 * Swedish user-facing texts. All text shown to users lives here (see CLAUDE.md).
 */
const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(ore / 100)} kr`;

export const sv = {
  app: {
    name: "Bojen",
    tagline: "Bokning, kundregister och receptionist för båtmekaniker",
  },
  booking: {
    title: (firm: string) => `Boka hos ${firm}`,
    stepOf: (step: number, total: number) => `Steg ${String(step)} av ${String(total)}`,
    next: "Nästa",
    back: "Tillbaka",
    steps: {
      service: "Tjänst",
      boat: "Båt",
      place: "Plats och läge",
      time: "Tid",
      photos: "Bilder",
      confirm: "Bekräfta",
    },
    service: {
      heading: "Vad behöver du hjälp med?",
      duration: (minutes: number) =>
        minutes % 60 === 0 ? `cirka ${String(minutes / 60)} h` : `cirka ${String(minutes)} min`,
      price: (ore: number) => `från ${kr(ore)} exkl. moms`,
      needsLand: "Båten behöver stå på land.",
      needsWater: "Båten behöver ligga i sjön.",
    },
    boat: {
      heading: "Din båt",
      newCustomer: "Jag är ny kund",
      existingCustomer: "Jag har bokat förut",
      phone: "Mobilnummer",
      sendCode: "Skicka kod",
      codeSent: "Vi har skickat en kod med sms om numret finns hos oss.",
      code: "Kod från sms",
      verify: "Logga in",
      wrongCode: "Koden stämmer inte. Försök igen.",
      expiredCode: "Koden har gått ut. Be om en ny.",
      alreadyCustomer:
        "Numret finns redan hos oss. Välj ”Jag har bokat förut” så skickar vi en kod.",
      chooseBoat: "Vilken båt gäller det?",
      otherBoat: "En annan båt",
      name: "Ditt namn",
      email: "E-post (valfritt)",
      boatName: "Båtens namn (valfritt)",
      make: "Båtmärke",
      model: "Modell",
      engineMake: "Motormärke",
      engineModel: "Motormodell",
      engineHours: "Gångtimmar (ungefär)",
    },
    place: {
      heading: "Var står båten?",
      marina: "Marina, varv eller klubb",
      chooseMarina: "Välj plats",
      otherAddress: "Annan plats (adress)",
      address: "Sök adress",
      noAddress: "Vi hittade ingen adress. Prova att skriva ort också.",
      mode: "Var är båten när vi kommer?",
      water: "I sjön",
      land: "På land",
      indoor: "Inomhus eller i hall",
      haulOut: "Datum för upptagning",
      launch: "Datum för sjösättning",
      changeDate: "När ändras det? (valfritt)",
      earliest: "Tidigast datum",
    },
    time: {
      heading: "Välj tid",
      loading: "Letar efter tider …",
      none: "Vi hittade inga lediga tider. Ring oss så hjälper vi dig.",
      marinaDay: (place: string) => `Mekanikern är på ${place} denna dag`,
      calloutWaived: (ore: number | null) =>
        ore ? `framkörning 0 kr (spara ${kr(ore)})` : "framkörning 0 kr",
      percentOff: (percent: number) => `${String(percent)} % rabatt på arbetet`,
      window: (label: string) => `kl ${label}`,
    },
    photos: {
      heading: "Bilder (valfritt)",
      help: "En bild på motorn eller drevet hjälper mekanikern att ta med rätt delar.",
      add: "Lägg till bilder",
      tooLarge: "En bild får vara högst 8 MB.",
      notes: "Något mer vi bör veta? (valfritt)",
    },
    confirm: {
      heading: "Stämmer det här?",
      submit: "Skicka bokningen",
      sending: "Skickar …",
      pending: "Tack! Vi har tagit emot din bokning och bekräftar den med sms så snart vi kan.",
      booked: "Tack! Din tid är bokad. Du får en bekräftelse med sms.",
      taken: "Tiden hann tyvärr bokas av någon annan. Välj en ny tid.",
      failed: "Något gick fel. Försök igen eller ring oss.",
    },
    errors: {
      required: "Fyll i det här fältet.",
      phone: "Skriv ett svenskt mobilnummer, till exempel 070-123 45 67.",
      notFound: "Sidan finns inte. Kontrollera länken.",
    },
  },
  signIn: {
    title: "Logga in",
    intro: "Personalen loggar in med en kod som vi skickar till din e-post eller mobil.",
    method: "Få koden med",
    byEmail: "E-post",
    bySms: "Sms",
    email: "E-postadress",
    mobile: "Mobilnummer",
    sendCode: "Skicka kod",
    codeSent: "Om adressen finns hos oss har vi skickat en kod. Den gäller i 10 minuter.",
    codeSentSms: "Om numret finns hos oss har vi skickat en kod med sms. Den gäller i 10 minuter.",
    code: "Kod från e-post",
    codeSms: "Kod från sms",
    verify: "Logga in",
    wrongCode: "Koden stämmer inte eller har gått ut. Be om en ny.",
    failed: "Något gick fel. Försök igen.",
    signOut: "Logga ut",
  },
  secondFactor: {
    enrollTitle: "Lägg till tvåfaktorsinloggning",
    enrollIntro:
      "Skanna QR-koden med en app för engångskoder, till exempel Microsoft Authenticator eller Google Authenticator. Skriv sedan in koden som appen visar.",
    enrollRequired: "Som ägare eller administratör behöver du logga in med två faktorer.",
    secret: "Kan du inte skanna? Skriv in den här nyckeln i appen:",
    code: "Kod från appen",
    confirm: "Bekräfta",
    wrongCode: "Koden stämmer inte. Vänta på nästa kod i appen och försök igen.",
    recoveryTitle: "Spara dina reservkoder",
    recoveryIntro:
      "Om du tappar telefonen kan du logga in med en av de här koderna. Varje kod fungerar en gång. Spara dem på ett säkert ställe; de visas bara nu.",
    continue: "Jag har sparat koderna",
    challengeTitle: "Kod från appen",
    challengeIntro: "Skriv in koden som din app för engångskoder visar.",
    useRecovery: "Jag har inte telefonen, använd en reservkod",
    recoveryCode: "Reservkod",
    useCode: "Använd koden",
    recoveryAccepted: "Koden godtogs. Lägg nu till appen igen på din nya telefon.",
    failed: "Något gick fel. Försök igen.",
  },
  flows: {
    weekdaysShort: ["mån", "tis", "ons", "tor", "fre", "lör", "sön"],
    mode: { water: "i sjön", land: "på land", indoor: "inomhus" },
    /** For a value the firm has not entered, so a template never has a gap. */
    unknown: "–",
    /** The access line in the e-mail: never the code, and not the key place either (F1). */
    keyText: "Enligt dina uppgifter hos oss",
    preparation: "Se till att båten är tillgänglig och att nyckeln finns där du har angett.",
    priceUnknown: "Enligt prislista",
    /** The task when the customer answers 1–3 to the satisfaction question (F9). */
    lowCsat: (who: string, score: number) => `Ring ${who}: betyg ${String(score)} av 5`,
  },
  inbox: {
    /** The task a person gets when a reply by sms cannot be read with certainty (step 3.2). */
    unclearReply: (who: string) => `Oklart sms-svar från ${who}`,
  },
  security: {
    title: "Säkerhet",
    intro: "Här ser du vilka i firman som loggar in med två faktorer.",
    name: "Namn",
    role: "Roll",
    roles: { owner: "Ägare", admin: "Administratör", mechanic: "Mekaniker" },
    secondFactor: "Tvåfaktor",
    on: "På",
    off: "Av",
    notSignedIn: "Har inte loggat in",
    revoke: "Spärra inloggningar",
    revokeHelp:
      "Loggar ut personen på alla enheter direkt, till exempel om en telefon har tappats bort.",
    revoked: "Alla inloggningar är spärrade.",
    reset: "Återställ tvåfaktor",
    resetDone: "Tvåfaktor är återställd. Personen lägger till appen igen nästa gång.",
    addOwn: "Lägg till tvåfaktor för dig själv",
    failed: "Det gick inte. Försök igen.",
  },
  requests: {
    title: "Förfrågningar",
    intro: "Bokningar som kunder har gjort och som väntar på ditt godkännande.",
    none: "Inga förfrågningar just nu.",
    approve: "Godkänn",
    reject: "Avböj",
    approved: "Godkänd. Kunden får en bekräftelse.",
    rejected: "Avböjd.",
    failed: "Det gick inte. Försök igen.",
    photos: (n: number) => (n === 1 ? "1 bild" : `${String(n)} bilder`),
  },
} as const;

export type Texts = typeof sv;

/**
 * Message templates from spec part 1, chapter 7, kept apart from `sv` so that the pages
 * that import `sv` do not ship them to the browser. `{name}` is filled in by
 * `messaging/render.ts`; `packages/core/src/messaging/templates.ts` says which channel,
 * category and segment limit each one has.
 */
export const messages = {
  sms: {
    staff_sign_in_code: "{code} är din kod för att logga in i Bojen. Den gäller i 10 minuter.",
    booking_code: "{code} är din kod för att boka hos {firm}.",
    stop_receipt: "Du är avregistrerad och får inga fler sms från {firm}.",
    f1_confirmation:
      "Hej {firstName}! Bokat: {serviceShort} {weekday} {date} kl {window}, {placeShort}. Du behöver inte vara på plats. Ändra/avboka: {link} /{firm}",
    f2_tentative:
      "Hej {firstName}! Preliminärt bokat {date} kl {window}. Vi väntar på delar och bekräftar när de kommit. /{firm}",
    f2_parts_arrived:
      "Delarna har kommit! Din tid {date} kl {window} på {placeShort} är nu bekräftad. Ändra: {link} /{firm}",
    f3_check_water:
      "Hej {firstName}! I morgon kl {window} servar vi {boat}. Ligger den i sjön på {placeShort} {placeId}, med nyckel i {keyPlace}? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_check_water_code:
      "Hej {firstName}! I morgon kl {window} servar vi {boat}. Ligger den i sjön på {placeShort} {placeId}, med nyckel i {keyPlace}? Gäller samma grindkod som sist? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_check_land:
      "Hej {firstName}! I morgon kl {window} kommer vi till {boat}. Står den på land på {placeShort}, nyckel i {keyPlace}? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_check_land_code:
      "Hej {firstName}! I morgon kl {window} kommer vi till {boat}. Står den på land på {placeShort}, nyckel i {keyPlace}? Gäller samma grindkod som sist? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_reply_yes: "Tack! Bokningen är bekräftad. Du får ungefärlig tid i morgon bitti.",
    f3_reply_no:
      "Okej, vi avbokar. Välj en ny tid här: {link} – eller svara NY så ringer vi dig. /{firm}",
    f3_reply_change: "Tack! {mechanicFirstName} hör av sig i dag. Skriv gärna här vad som ändrats.",
    f3_reminder:
      "Påminnelse: vi kommer i morgon kl {window} till {placeShort}. Är båten tillgänglig? Svara JA, NEJ eller ÄNDRA.",
    f4_offer:
      "Ledig tid! {weekday} {date} kl {window} på/nära {placeShort} – passar {serviceShort} för {boat}? Svara JA inom 1 tim så är den din. /{firm}",
    f4_taken: "Tiden blev tyvärr tagen. Du står kvar på väntelistan – vi hör av oss!",
    f5_eta:
      "God morgon! {mechanicFirstName} beräknas vara vid {boat} på {placeShort} ca kl {etaFrom}–{etaTo} i dag. /{firm}",
    f6_on_way: "{mechanicFirstName} är på väg till {placeShort}, framme ca kl {eta}. /{firm}",
    f7_report:
      "Klart! {serviceShort} på {boat} är utförd. Rapport, bilder och betalning: {link} Tack för förtroendet! /{firm}",
    f8_payment_reminder:
      "Hej {firstName}! En vänlig påminnelse: fakturan på {amount} kr förföll {date}. Betala enkelt här: {link} /{firm}",
    f9_survey:
      "Hur nöjd är du med servicen i går? Svara med en siffra 1–5 (5 = mycket nöjd). /{firm}",
    f9_reply_good:
      "Tack, vad glad jag blir! Vill du hjälpa andra båtägare hitta hit? En recension tar 30 sek: {googleLink} /{mechanicFirstName}",
    f9_reply_poor:
      "Tack för ärligt svar. Jag vill göra det bra igen – jag ringer dig senast i morgon. /{mechanicFirstName}",
    f10_next_season:
      "Hej {firstName}! Ska vi boka vårservicen redan nu? Jag har en tid {weekday} {date} (v.{week}) på {placeShort}. Svara JA eller välj annan: {link} Svara STOPP för att avsluta. /{firm}",
    f11_spring_a:
      "Hej {firstName}! Dags att planera våren. Förra året servade vi {boat} v.{lastWeek}. Jag har reserverat {weekday} {date} kl {window} på {placeShort}. Svara JA, ANNAN eller NEJ. Svara STOPP för att avsluta. /{firm}",
    f11_spring_discount:
      "Hej {firstName}! Vill du vara först i sjön? Boka vårservice v.{week} och få {discount} % på arbetet. Jag har {weekday} {date} ledigt på {placeShort}. Svara JA eller ANNAN. Svara STOPP för att avsluta. /{firm}",
    f11_spring_b:
      "Hej {firstName}! Vi konserverade {boat} i höstas. Ska vi göra vårservicen också? Förslag: {date} på {placeShort}. Svara JA eller ANNAN. Svara STOPP för att avsluta. /{firm}",
    f11_sold_question: "Har du sålt båten? Svara SÅLD. /{firm}",
    f12_autumn:
      "Hej {firstName}! Snart dags för upptagning. Förra året vinterkonserverade vi {boat} v.{lastWeek}. Förslag i år: {date} på {placeShort}. Svara JA, ANNAN eller NEJ. Svara STOPP för att avsluta. /{firm}",
    f12_haulout_question:
      'Tack! Vilket datum tas båten upp, och står den kvar på {placeShort}? Svara t.ex. "12/10 Bullandö".',
    f13_service_reminder:
      "Hej {firstName}! {boat} närmar sig sin service ({reason}). Vill du boka? Lediga tider på {placeShort}: {link} Svara STOPP för att avsluta. /{firm}",
    f14_received:
      "Vi har fått ditt ärende och meddelat {mechanicFirstName}. Du får svar inom 30 min. Vid fara: ring 112. /{firm}",
    f14_taken:
      "{mechanicFirstName} kommer i dag kl {window} till {placeShort}. Akuttillägg {emergencyPrice} kr + timpris enligt prislista. Frågor? Ring {phone} /{firm}",
    f14_none_available:
      "Tyvärr kan vi inte komma i dag. Första lediga tid är {date} kl {window}. Svara JA för att boka den. /{firm}",
    f14_moved:
      "Hej {firstName}! Ett akut haveri gör att vi behöver flytta din tid {date}. Förlåt! Ny tid: {newDate} kl {window} med 10 % rabatt. Svara JA eller ANNAN.",
    f15_type_plate:
      "Hej! Skicka gärna en bild på motorns typskylt (och felet om det går) här: {link} – så tar vi med rätt delar direkt. /{firm}",
  },
  push: {
    f3_unconfirmed:
      "⚠️ Obekräftad: {customer}, {boat}, {place} i morgon {window}. Inget svar på 2 sms.",
    f14_emergency:
      "🚨 AKUT {placeShort}: {boat} – {symptomShort}. Kund: {customer}. Bilder: {photoCount}.",
  },
  email: {
    f1_confirmation: {
      subject: "Bokningsbekräftelse: {service} {date}",
      body: `Hej {firstName},

tack för din bokning! Här är detaljerna:

**Vad:** {service}
**Båt:** {boatMake} {boatModel} – {engineMake} {engineModel}
**När:** {weekday} {date}, mellan kl. {window}
**Var:** {placeName}, {placeDetail} ({mode})
**Åtkomst:** {keyText} (koden visas inte i e-post av säkerhetsskäl)
**Uppskattat pris:** {priceIndication} kr inkl. moms, plus delar enligt åtgång

**Så förbereder du:**
{preparation}

Du behöver inte vara på plats. Dagen innan får du ett sms där du bekräftar att båten är tillgänglig.

**Behöver du ändra?** Boka om eller avboka här: {link}. Avbokning är kostnadsfri fram till {cancelBy}.

Hälsningar
{mechanicName}, {firm}
{phone} · {web}`,
    },
    f7_report: {
      subject: "Servicerapport: {boat}, {date}",
      body: `Hej {firstName},

nu är {service} på din {boatMake} {boatModel} klar. Här är en sammanfattning.

**Utfört arbete**
{workDone}

**Gångtimmar:** {hours} h (förra besöket: {previousHours} h)

**Bytta delar**
{parts}

**Rekommendationer**
{recommendations}

**Bilder:** {galleryLink}

**Nästa service:** {nextService}. Vi påminner dig i god tid.

Har du frågor? Svara på detta mejl eller ring {phone}.

Hälsningar
{mechanicName}, {firm}`,
    },
    f11_spring: {
      subject: "{boat}: ska vi boka vårservicen?",
      body: `Hej {firstName},

det känns långt bort, men vårens tider fylls snabbt. Förra året servade vi din {boatMake} {boatModel} vecka {lastWeek}, och jag har reserverat en liknande tid i år:

**{weekday} {date}, kl. {window} – {placeName}**

Ja, boka tiden: {bookLink}
Välj en annan tid: {otherLink}

**Vad ingår i vårservicen?**
{serviceContents}

**Rekommendationer från förra besöket**
{openRecommendations}. Vill du att vi tar dem samtidigt? Kryssa i när du bokar.

Tiden hålls till {reservedUntil}.

Hälsningar
{mechanicName}, {firm}`,
    },
  },
} as const;
