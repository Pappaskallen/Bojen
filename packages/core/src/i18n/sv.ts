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
    /** How the availability check (F3) names the day; `monday` goes out on the Friday. */
    checkDay: { tomorrow: "I morgon", monday: "På måndag" },
    /** The same inside a sentence, for the reminder. */
    checkDayInline: { tomorrow: "i morgon", monday: "på måndag" },
    /** The task when the customer answers ÄNDRA to the availability check (F3). */
    changeRequest: (who: string) => `${who} vill ändra något inför besöket`,
    /** The task when nobody has answered the check and its reminder (F3). */
    callUnconfirmed: (who: string) => `Ring ${who}: inget svar på kontrollen`,
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
      "Hej {firstName}! {day} kl {window} servar vi {boat}. Ligger den i sjön på {place}, med nyckeln där du har angett? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_check_water_code:
      "Hej {firstName}! {day} kl {window} servar vi {boat}. Ligger den i sjön på {place}, med nyckeln där du har angett? Gäller samma grindkod som sist? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_check_land:
      "Hej {firstName}! {day} kl {window} kommer vi till {boat}. Står den på land på {placeShort}, med nyckeln där du har angett? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_check_land_code:
      "Hej {firstName}! {day} kl {window} kommer vi till {boat}. Står den på land på {placeShort}, med nyckeln där du har angett? Gäller samma grindkod som sist? Svara JA, NEJ eller ÄNDRA. /{firm}",
    f3_reply_yes: "Tack! Bokningen är bekräftad. Du får ungefärlig tid i morgon bitti.",
    f3_reply_no:
      "Okej, vi avbokar. Välj en ny tid här: {link} – eller svara NY så ringer vi dig. /{firm}",
    f3_reply_change: "Tack! {mechanicFirstName} hör av sig i dag. Skriv gärna här vad som ändrats.",
    f3_reminder:
      "Påminnelse: vi kommer {day} kl {window} till {placeShort}. Är båten tillgänglig? Svara JA, NEJ eller ÄNDRA.",
    f4_offer:
      "Ledig tid! {weekday} {date} kl {window} {at} {placeShort} – passar {serviceShort} för {boat}? Svara JA inom 1 tim så är den din. /{firm}",
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
    f11_other_times: "Inga problem! Välj en tid som passar dig här: {link} /{firm}",
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
    voice_booking_link: "Här är din bokning. Där kan du också boka om eller avboka: {link} /{firm}",
    voice_access_link:
      "Här lägger du in koden och var nyckeln finns. Den krypteras och visas bara för mekanikern: {link} /{firm}",
    voice_pictures_link: "Här kan du skicka bilder på båten och felet till oss: {link} /{firm}",
    voice_message_soon: "Tack för samtalet! Vi ringer upp dig inom 30 minuter. /{firm}",
    voice_message_promise: "Tack för samtalet! Vi återkommer {promise}. /{firm}",
    voice_first_time:
      "Förlåt att ingen har hunnit ringa upp dig. Boka första lediga tid här: {link} eller ring oss igen. /{firm}",
    staff_alert: "Bojen: {title}. {note} Svara här: {link}",
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

/**
 * The customer's page behind the short link, `/x/{code}` (step 3.4). Its own export, like
 * `messages`, so the booking page does not ship these texts to the browser.
 */
export const customerPage = {
  title: "Din bokning",
  when: "När",
  where: "Var",
  what: "Vad",
  boat: "Båt",
  mechanic: "Mekaniker",
  pending: "Väntar på att firman godkänner tiden.",
  reserved: "Vi har reserverat tiden åt dig. Vill du ha den?",
  accept: "Ja, boka tiden",
  reschedule: "Boka om",
  rescheduleIntro: "Välj en ny tid. Den gamla tiden släpps direkt.",
  noTimes: "Det finns inga lediga tider att välja här just nu. Ring oss så hjälper vi dig.",
  chooseTime: "Boka om till vald tid",
  cancel: "Avboka",
  cancelIntro: (cancelBy: string) => `Avbokning är kostnadsfri fram till ${cancelBy}.`,
  cancelConfirm: "Ja, avboka besöket",
  tooLate: (cancelBy: string, phone: string) =>
    `Gränsen för att ändra själv var ${cancelBy}. Ring oss på ${phone} så hjälper vi dig.`,
  access: "Koder och nyckel",
  accessIntro:
    "Lägg in koden till båten eller var nyckeln finns. Uppgifterna krypteras och visas bara för mekanikern som har besöket. De skickas aldrig i sms eller e-post.",
  accessStored: "Du har redan lämnat uppgifter. Fyll bara i det du vill ändra.",
  accessCode: "Kod (lås, larm eller grind)",
  keyLocation: "Var finns nyckeln?",
  accessSave: "Spara uppgifterna",
  noBoat: "Det finns ingen båt kopplad till bokningen. Ring oss om du vill lämna koder.",
  pictures: "Bilder och typskylt",
  picturesIntro:
    "Skicka gärna en bild på motorns typskylt och på felet, så tar mekanikern med rätt delar. Högst 5 bilder, jpg, png, webp eller heic.",
  picturesField: "Välj eller ta bilder",
  picturesSave: "Skicka bilderna",
  done: {
    rescheduled: "Klart, besöket är ombokat. Du får ett nytt sms med den nya tiden och en ny länk.",
    cancelled: "Klart, besöket är avbokat.",
    access: "Tack! Uppgifterna är sparade och krypterade.",
    accepted: "Klart, tiden är bokad. Du får en bekräftelse strax.",
    pictures: "Tack! Bilderna är skickade till mekanikern.",
  },
  errors: {
    missing: "Länken finns inte. Kontrollera att du har skrivit av den rätt.",
    expired: "Länken har gått ut. Ring oss om du vill ändra något.",
    used: "Länken är redan använd. Använd länken i det senaste sms:et från oss, eller ring oss.",
    closed: "Besöket går inte längre att ändra här. Ring oss om du har frågor.",
    taken: "Tiden hann bli bokad av någon annan. Välj en annan tid.",
    invalid: "Något saknas eller är för långt. Kontrollera och försök igen.",
    failed: "Något gick fel. Försök igen eller ring oss.",
  },
  callUs: (phone: string) => `Ring oss: ${phone}`,
} as const;

/**
 * The staff pages for customers (step 5.1): the list with search, and the customer card. Its
 * own export, like `messages`, so the booking page does not ship these texts to the browser.
 */
export const crm = {
  nav: {
    label: "Meny",
    overview: "Översikt",
    today: "Idag",
    tasks: "Ärenden",
    requests: "Förfrågningar",
    pipeline: "Pipeline",
    customers: "Kunder",
    places: "Marinor",
    campaigns: "Kampanjer",
    security: "Säkerhet",
  },
  /** The dashboard in the phone (step 7.2, spec 9.2). */
  dashboard: {
    title: "Översikt",
    month: "Månad",
    previousMonth: "Föregående månad",
    nextMonth: "Nästa månad",
    today: "Idag",
    jobsToday: (jobs: number, places: number) =>
      `${String(jobs)} jobb · ${String(places)} ${places === 1 ? "marina" : "marinor"}`,
    confirmed: (n: number) => `${String(n)} bekräftade`,
    drive: (text: string) => `${text} körning`,
    openRoute: "Öppna dagens rutt →",
    noJobsToday: "Inga jobb idag.",
    revenueIn: (month: string) => `Intäkt ${month}`,
    against: (change: string, month: string) => `${change} mot ${month}`,
    weeks: (first: number, last: number) =>
      first === last ? `v.${String(first)}` : `v.${String(first)}–v.${String(last)}`,
    prebooked: (season: string) => `${season} förbokad`,
    sameDayLastYear: (value: string, change: string | null) =>
      `samma dag förra året: ${value}${change ? `  ${change}` : ""}`,
    /** A change in percentage points, as in the sketch ("▲17 pe"). */
    points: (share: number) =>
      `${share >= 0 ? "▲" : "▼"} ${String(Math.round(Math.abs(share) * 100))} pe`,
    noSnapshotYet: "Jämförelsen med förra året kommer när det finns ett år av ögonblicksbilder.",
    seasons: { spring: "Våren", autumn: "Hösten" } as Record<"spring" | "autumn", string>,
    customers: "Kunder",
    csat: (value: string) => `CSAT ${value}`,
    reviewClicks: (n: number) => `${String(n)} till recension`,
    todo: (n: number) => `Att göra (${String(n)})`,
    noTodo: "Inget att göra.",
    allTasks: "Alla ärenden →",
    level: { green: "målet nått", yellow: "nära målet", red: "långt från målet" } as Record<
      "green" | "yellow" | "red",
      string
    >,
    target: (text: string) => `Mål: ${text}`,
    kpis: {
      revenue: "Intäkt",
      revenuePerWorkDay: "Intäkt per arbetsdag",
      averageOrder: "Snittordervärde",
      occupancy: "Beläggning",
      billableShare: "Fakturerbar andel",
      driveShare: "Körandel",
      visitsPerMarinaStop: "Jobb/marina",
      noAccess: "Ej tillgänglig",
      confirmation: "Bekräftelsegrad",
      refill: "Återfyllnad",
      hoursToBooking: "Förfrågan → bokning",
      prebooking: "Förbokning",
      csat: "CSAT",
    },
    back: "← Översikt",
    perWeek: "Per vecka",
    perMechanic: "Per mekaniker",
    perService: "Per tjänst",
    snapshots: "Senaste ögonblicksbilderna",
    week: (n: number) => `v.${String(n)}`,
    nothing: "–",
    ownersOnly: "Översikten är för ägare och administratörer.",
  },
  /** The campaigns (step 5.6). */
  campaigns: {
    title: "Kampanjer",
    none: "Inga kampanjer än.",
    newTitle: "Ny vårkampanj",
    intro:
      "Vårkampanjen reserverar en tid samma vecka som förra året, helst samma dag som andra båtar på marinan, och frågar kunden med sms (e-post till den som saknar mobil). Utskicken går tisdag till torsdag kl. 18.30. JA bokar tiden, ANNAN ger länken till bokningssidan och NEJ frågar om båten är såld. Tiden släpps efter 14 dagar utan svar.",
    name: "Namn",
    defaultName: (year: number) => `Vårkampanj ${String(year)}`,
    year: "Våren",
    startDate: "Första utskick tidigast",
    springServices: "Tjänster som räknas som vårservice förra våren (segment A)",
    layUpServices: "Tjänster som räknas som vinterkonservering i höstas (segment B)",
    bookService: "Tjänsten som bokas när kunden svarar JA",
    batchSize: "Mottagare per utskick",
    defaultWeek: "Vecka för båtar utan besök förra våren och utan sjösättningsdatum",
    discount: "Rabatt på arbetet, procent (tomt: ingen)",
    create: "Skapa utkast",
    open: "Öppna",
    status: {
      draft: "Utkast",
      scheduled: "Planerad",
      sending: "Skickas",
      done: "Utskickad",
      cancelled: "Avbruten",
    } as Record<string, string>,
    segments: "Mottagare",
    segmentA: "Segment A: vårservice förra våren",
    segmentB: "Segment B: vinterkonservering i höstas, ingen vårservice",
    segmentC: "Segment C: förfallen service enligt serviceplanen kommer när serviceplanen finns.",
    excludedTitle: "Utelämnas",
    excluded: {
      sold: "såld båt",
      opted_out: "har svarat STOPP",
      low_rating: "betyg 1–2 med öppet ärende",
      booked: "redan bokad i vår",
      no_contact: "saknar mobil och e-post",
    } as Record<string, string>,
    noInvoicesYet: "Obetalda fakturor utelämnas när fakturorna finns (Fortnox).",
    start: "Starta kampanjen",
    startHelp: (when: string) =>
      `Mottagarna läggs in nu. Första utskicket går ${when}, sedan tisdag till torsdag kl. 18.30 tills alla har fått.`,
    firstRound: (when: string) => `Första utskicket: ${when}.`,
    numbers: "Läget",
    recipients: "Mottagare",
    sent: "Skickade",
    booked: "Bokade",
    declined: "Avböjde",
    noReply: "Inget svar (tiden släppt)",
    otherTime: "Ville ha annan tid",
    waiting: "Väntar på svar",
    noSlot: "Ingen ledig tid i veckan",
    prebooked: "Förbokade båtar i vår",
    prebookedCompare: (now: number, last: number) =>
      `${String(now)} båtar bokade för våren hittills, mot ${String(last)} samma dag förra året.`,
    heldTime: "Reserverad tid",
    answer: {
      yes: "JA",
      other: "ANNAN",
      no: "NEJ",
      sold: "SÅLD",
    } as Record<string, string>,
    recipientStatus: {
      pending: "Väntar på utskick",
      sent: "Skickad",
      booked: "Bokad",
      declined: "Avböjde",
      no_reply: "Inget svar",
    } as Record<string, string>,
    problem: {
      no_slot: "ingen ledig tid",
      sold: "såld",
      booked: "bokade själv",
      opted_out: "STOPP",
      low_rating: "lågt betyg",
      no_contact: "ingen kontakt",
      left: "inte längre med",
    } as Record<string, string>,
    doneMessage: {
      skapad: "Utkastet är skapat. Se mottagarna och starta när du är redo.",
      startad: "Kampanjen är startad.",
    } as Record<string, string>,
    errors: {
      forbidden: "Bara ägare och administratörer kan skapa och starta kampanjer.",
      invalid_input: "Något saknas eller är fel. Kontrollera och försök igen.",
      wrong_state: "Kampanjen är redan startad.",
      not_found: "Kampanjen finns inte.",
      failed: "Något gick fel. Försök igen.",
    } as Record<string, string>,
  },
  list: {
    title: "Kunder",
    searchLabel: "Sök kund",
    searchHelp: "Namn, telefon, e-post, båt, motor, serienummer eller marina.",
    searchButton: "Sök",
    showAll: "Visa alla kunder",
    none: "Inga kunder hittades.",
    noneYet: "Det finns inga kunder än.",
    resultsFor: (query: string) => `Sökning: ${query}`,
    range: (from: number, to: number) => `Visar ${String(from)}–${String(to)}`,
    previous: "Föregående",
    next: "Nästa",
    noBoats: "Ingen båt",
  },
  card: {
    back: "Alla kunder",
    contact: "Kontakt",
    phone: "Telefon",
    email: "E-post",
    billingAddress: "Faktureringsadress",
    language: "Språk",
    source: "Hittade oss via",
    since: "Kund sedan",
    boats: "Båtar",
    noBoats: "Inga båtar är kopplade till kunden.",
    length: (m: string) => `${m.replace(/\.?0+$/, "").replace(".", ",")} m`,
    year: (y: number) => `årsmodell ${String(y)}`,
    visits: "Besök",
    noVisits: "Inga besök än.",
    upcoming: "Kommande",
    earlier: "Tidigare",
    timeline: "Meddelanden",
    timelineHelp: (n: number) => `De ${String(n)} senaste, nyast först.`,
    noMessages: "Inga meddelanden än.",
    subject: "Ämne",
    unknown: "–",
  },
  /** The boat card (step 5.2). */
  boat: {
    nameplate: "Förslag från typskylt",
    nameplateIntro:
      "Läst av AI från en bild som kunden skickade. Kontrollera mot bilden innan du använder förslaget.",
    nameplateRead: (make: string, confidence: number) =>
      `${make}, säkerhet ${String(Math.round(confidence * 100))} %`,
    nameplatePicture: "Visa bilden",
    nameplateEngine: "Till motor",
    nameplateNewEngine: "Ny motor",
    nameplateUse: "Använd på motorn",
    nameplateDismiss: "Avfärda",
    nameplateDone: {
      confirmed: "Motorn är uppdaterad från typskylten.",
      dismissed: "Förslaget är avfärdat.",
    } as Record<string, string>,
    nameplateErrors: {
      not_found: "Förslaget eller motorn finns inte.",
      decided: "Förslaget är redan hanterat.",
      failed: "Något gick fel. Försök igen.",
    } as Record<string, string>,
    title: "Båtkort",
    unnamed: "Båt utan namn",
    about: "Om båten",
    make: "Märke och modell",
    length: "Längd",
    year: "Årsmodell",
    hull: "Skrovtyp",
    registration: "Registreringsnummer",
    status: "Status",
    owners: "Ägare och kontakter",
    noOwners: "Ingen kund är kopplad till båten.",
    placements: "Placering",
    noPlacements: "Båten har ingen placering än.",
    here: "Här nu",
    launch: "Sjösättning",
    haulOut: "Upptagning",
    spot: (id: string) => `plats ${id}`,
    engines: "Motorer och drev",
    noEngines: "Inga motorer registrerade.",
    serial: "Serienummer",
    drive: "Drev",
    modelYear: (y: number) => `årsmodell ${String(y)}`,
    hours: "Gångtimmar",
    noHours: "Inga mätningar av gångtimmar än.",
    hoursAxis: "timmar",
    hoursTable: "Alla mätningar",
    readAt: "Datum",
    hoursColumn: "Timmar",
    source: "Källa",
    engine: "Motor",
    history: "Servicehistorik",
    noHistory: "Inga besök än.",
    report: "Rapport",
    recommendations: "Rekommendationer",
    noRecommendations: "Inga rekommendationer från tidigare rapporter.",
    nextService: (when: string) => `Nästa service: ${when}`,
    fromReport: (date: string) => `Från rapporten ${date}`,
    pictures: "Bilder",
    noPictures: "Inga bilder än.",
    picture: (n: number) => `Bild ${String(n)}`,
    access: "Åtkomst",
    accessIntro:
      "Koder och nyckelplats visas bara för ägaren och för mekanikern som har ett besök på båten, från 12 timmar före till 12 timmar efter starttiden. Varje visning loggas.",
    stored: "Sparad",
    missing: "Saknas",
    code: "Kod",
    keyLocation: "Nyckelplats",
    gateCode: "Grindkod",
    keyBox: "Nyckelskåp",
    contact: "Kontakt på plats",
    show: "Visa åtkomst",
    confirm: "Visningen loggas med ditt namn och tid. Vill du visa åtkomsten?",
    confirmYes: "Ja, visa",
    confirmNo: "Avbryt",
    loading: "Hämtar …",
    hidesIn: (s: number) => `Döljs om ${String(s)} s`,
    hide: "Dölj nu",
    denied: {
      not_assigned:
        "Du kan bara se koden för dina egna besök, från 12 timmar före till 12 timmar efter starttiden.",
      outside_window:
        "Koden kan visas från 12 timmar före till 12 timmar efter starttiden för ditt besök.",
      role_not_allowed: "Administratörer kan inte se koder och nyckelplats.",
      boat_not_found: "Båten finns inte.",
      failed: "Det gick inte att hämta åtkomsten. Försök igen.",
    } as Record<string, string>,
  },
  /** Passkeys for staff (step 5.5c). */
  passkey: {
    title: "Passkey",
    intro:
      "Med en passkey loggar du in med Face ID, fingeravtryck eller telefonens kod i stället för en kod. Den låser också dagvyn och skyddar koderna som sparas på telefonen.",
    count: (n: number) =>
      n === 0
        ? "Du har ingen passkey än."
        : n === 1
          ? "Du har 1 passkey."
          : `Du har ${String(n)} passkeys.`,
    add: "Lägg till passkey på den här telefonen",
    added: "Klart. Passkeyn är sparad och kan skydda koderna på telefonen.",
    addedNoPrf:
      "Klart. Passkeyn är sparad. Den här telefonen kan inte spara koder krypterat, så de visas bara med täckning.",
    addFailed: "Det gick inte att lägga till passkeyn. Försök igen.",
    unsupported: "Den här webbläsaren kan inte använda passkeys.",
    signIn: "Logga in med passkey",
    signInFailed: "Det gick inte att logga in med passkey. Använd en kod i stället.",
    or: "eller med en kod:",
  },
  /** The marina list and card (step 5.3). */
  place: {
    list: "Marinor och varv",
    listIntro: "Marinor, klubbar och varv där firmans kunder har båtar.",
    none: "Inga marinor än.",
    boatsNow: (n: number) => (n === 1 ? "1 båt här nu" : `${String(n)} båtar här nu`),
    back: "Alla marinor",
    about: "Om platsen",
    type: "Typ",
    address: "Adress",
    access: "Tar sig dit",
    crossing: (min: number) => `${String(min)} min överfart`,
    asCustomer: "Som kund",
    bookingLink: "Bokningslänk",
    bookingHelp: "Länken till firmans bokningssida med platsen redan vald. Dela den med marinan.",
    noBookingLink: "Platsen har ingen egen länk än.",
    contacts: "Kontaktpersoner",
    noContacts: "Inga kontaktpersoner sparade.",
    rules: "Regler för tillträde",
    noRules: "Inga regler sparade.",
    openingHours: "Öppettider",
    checkIn: "Anmälan",
    parking: "Parkering",
    gateCode: "Grindkod",
    keyBox: "Nyckelskåp",
    codesNote: "Koderna visas på båtkortet, för den som har ett besök där.",
    dates: "Sjösättning och upptagning",
    launches: "Sjösättning",
    haulOuts: "Upptagning",
    noDates: "Inga datum sparade.",
    dateCount: (n: number) => (n === 1 ? "1 båt" : `${String(n)} båtar`),
    boats: "Båtar",
    noBoats: "Inga båtar står här.",
    here: "Här nu",
    hoursKey: { weekdays: "Vardagar", weekend: "Helger" } as Record<string, string>,
  },
  placeType: {
    marina: "Marina",
    club: "Båtklubb",
    yard: "Varv",
    private_dock: "Egen brygga",
    home: "Hemma",
  },
  accessMethod: { car: "Bil", boat: "Båt", ferry: "Färja" },
  /** The pipeline (step 5.4). */
  pipeline: {
    title: "Pipeline",
    intro: "Dra ett kort till en annan kolumn, eller välj kolumn i listan på kortet.",
    columns: {
      inquiry: "Förfrågan",
      quote: "Offert",
      parts_ordered: "Delar beställda",
      booked: "Bokat",
      done: "Utfört",
      invoiced: "Fakturerat",
      paid: "Betalt",
    } as Record<string, string>,
    empty: "Inga kort",
    count: (n: number) => (n === 1 ? "1 kort" : `${String(n)} kort`),
    moveTo: "Flytta till",
    moved: (to: string) => `Flyttat till ${to}.`,
    forbidden: "Du kan bara flytta jobb där du har ett besök.",
    failed: "Det gick inte att flytta kortet. Försök igen.",
    noVisit: "Ingen tid bokad",
    settledNote: (n: number) => `De ${String(n)} senaste visas.`,
  },
  /** The mechanic's day view (step 5.5). */
  day: {
    title: "Idag",
    other: (day: string) => `Dag: ${day}`,
    previous: "Föregående dag",
    next: "Nästa dag",
    none: "Inga besök den här dagen.",
    route: "Körordning",
    saves: (minutes: number) => `Förslaget sparar ungefär ${String(minutes)} min körning.`,
    asBooked: "Den bokade ordningen är redan kortast.",
    manyStops: "Fler än 8 stopp: den bokade ordningen visas.",
    call: "Ring",
    start: "Starta",
    done: "Klart",
    hours: "Gångtimmar",
    lastHours: (h: number) => `Senast: ${String(h)} h`,
    save: "Spara",
    parts: "Delar",
    noParts: "Inga delar på jobbet.",
    addPart: "Lägg till del",
    articleNumber: "Artikelnummer",
    partDescription: "Benämning (ny del)",
    quantity: "Antal",
    photos: "Bilder",
    photoCount: (n: number) => (n === 1 ? "1 bild" : `${String(n)} bilder`),
    addPhoto: "Ta eller välj bild",
    upload: "Ladda upp",
    notes: "Anteckning",
    notesHelp: "Det du skriver här blir underlag för rapporten.",
    saveNote: "Spara anteckning",
    voice: "Röstanteckning",
    voiceCount: (n: number) => (n === 1 ? "1 röstanteckning" : `${String(n)} röstanteckningar`),
    record: "Spela in",
    stopRecording: "Stoppa inspelningen",
    recording: "Spelar in …",
    recorded: (seconds: number) => `Inspelad: ${String(seconds)} s. Spara för att skicka.`,
    voiceFile: "Spela in eller välj ljudfil",
    saveVoice: "Spara röstanteckning",
    voiceHelp: "Det du säger skrivs ut när det finns täckning och blir underlag för rapporten.",
    report: "Rapport",
    reportStatus: {
      drafting: "Rapporten skrivs …",
      draft: "Rapportutkast klart",
      approved: "Rapporten är skickad",
    } as Record<string, string>,
    openReport: "Granska rapporten",
    boatPicture: (boat: string) => `Bild på ${boat}`,
    lock: {
      title: "Dagvyn är låst",
      intro: "Lås upp med Face ID, fingeravtryck eller telefonens kod.",
      unlock: "Lås upp",
      failed: "Det gick inte att låsa upp. Försök igen.",
      noPasskey:
        "Lägg till en passkey under Säkerhet, så låses dagvyn och koderna kan sparas krypterat på telefonen.",
      codes: "Koder och nyckel",
      show: "Visa kod och nyckel",
      stored: "Koderna finns krypterade på telefonen, även utan täckning.",
      notStored: "Koderna hämtas till telefonen 12 timmar före besöket.",
      onlineOnly: "Den här passkeyn kan inte spara koder på telefonen; de visas bara med täckning.",
      notYet: "Koderna kan hämtas från 12 timmar före besöket.",
      offlineOnly: "Koderna kan bara visas med täckning på den här telefonen.",
    },
    offline: {
      waiting: (n: number) =>
        n === 1 ? "1 ändring väntar på täckning." : `${String(n)} ändringar väntar på täckning.`,
      saved: "Sparat på telefonen. Det skickas när det finns täckning.",
      sending: "Skickar det som väntade …",
      signIn: "Logga in igen för att skicka det som väntar. Inget har försvunnit.",
      refused: (label: string, why: string) => `${label}: ${why}`,
    },
    partStatus: {
      needed: "Behövs",
      ordered: "Beställd",
      delivered: "Levererad",
      installed: "Monterad",
    } as Record<string, string>,
    doneMessage: {
      starta: "Besöket är startat.",
      klart: "Besöket är klart.",
      timmar: "Gångtimmarna är sparade.",
      del: "Delen är tillagd.",
      delstatus: "Delen är uppdaterad.",
      bild: "Bilden är sparad.",
      anteckning: "Anteckningen är sparad.",
      rost: "Röstanteckningen är sparad.",
      synk: "Allt som väntade är skickat.",
    } as Record<string, string>,
    errors: {
      forbidden: "Du kan bara ändra dina egna besök.",
      not_found: "Besöket eller motorn finns inte.",
      invalid_input: "Något saknas eller är fel. Kontrollera och försök igen.",
      hours_below_last: "Gångtimmarna kan inte vara lägre än förra mätningen.",
      bad_picture: "Bilden måste vara jpg, png, webp eller heic och högst 12 MB.",
      bad_audio: "Ljudet måste vara webm, ogg, m4a, mp3 eller wav och högst 12 MB.",
      wrong_state: "Det går inte i besökets nuvarande läge.",
      failed: "Något gick fel. Försök igen.",
    } as Record<string, string>,
  },
  /** The service report and the invoice basis (step 5.5d). */
  report: {
    title: "Servicerapport",
    back: "Till dagvyn",
    aiDraft:
      "Utkastet är skrivet av AI från det du registrerade. Läs igenom och ändra innan du godkänner.",
    drafting: "Rapporten skrivs. Du kan vänta en stund eller skriva själv.",
    approvedAt: (when: string) => `Godkänd och skickad till kunden ${when}.`,
    facts: "Underlag",
    hours: "Gångtimmar",
    previous: (h: string) => `förra: ${h}`,
    voiceNotes: "Röstanteckningar",
    notTranscribed: "Inte utskriven än.",
    workDone: "Utfört arbete",
    workDoneHelp: "En punkt per rad.",
    recommendations: "Rekommendationer",
    recommendation: "Rekommendation",
    priorityLabel: "Prioritet",
    priority: { now: "Åtgärda nu", next_season: "Nästa säsong", monitor: "Håll koll" } as Record<
      string,
      string
    >,
    nextService: "Nästa service",
    invoice: "Fakturaunderlag",
    lineType: {
      labour: "Arbete",
      callout: "Framkörning",
      emergency: "Akuttillägg",
      discount: "Rabatt",
      part: "Del",
    } as Record<string, string>,
    description: "Benämning",
    quantity: "Antal eller timmar",
    unitPrice: "À-pris, kr exkl. moms",
    amount: "Belopp",
    remove: "Ta bort",
    addLine: "Lägg till rad",
    type: "Typ",
    noLines: "Inga rader än.",
    noPrice: "Delen saknar pris: lägg in utpris i prislistan eller en egen rad.",
    partsHelp: "Delarna kommer från jobbet och ändras i dagvyn.",
    net: "Summa exkl. moms",
    vat: "Moms 25 %",
    gross: "Totalt inkl. moms",
    save: "Spara utkast",
    approve: "Godkänn och skicka till kunden",
    approveHelp: "Kunden får rapporten med sms och e-post. Därefter går den inte att ändra.",
    doneMessage: {
      sparat: "Utkastet är sparat.",
      rad: "Raden är tillagd.",
      bort: "Raden är borttagen.",
      godkand: "Rapporten är godkänd och skickas till kunden.",
    } as Record<string, string>,
    errors: {
      forbidden: "Du kan bara ändra rapporter för dina egna besök.",
      not_found: "Rapporten finns inte.",
      invalid_input: "Något saknas eller är fel. Kontrollera och försök igen.",
      approved: "Rapporten är redan skickad och kan inte ändras.",
      empty: "Skriv vad som är gjort innan du godkänner.",
      failed: "Något gick fel. Försök igen.",
    } as Record<string, string>,
    /** In the e-mail to the customer (F7). */
    hoursLine: (engine: string, hours: string) => `${engine}: ${hours}`,
    partLine: (description: string, articleNumber: string, quantity: string) =>
      `${description} (art.nr ${articleNumber}) × ${quantity}`,
    recommendationLine: (priority: string, text: string) => `${priority}: ${text}`,
  },
  season: { summer: "Sommar", winter: "Vinter" },
  enginePosition: { port: "Babord", stbd: "Styrbord", single: "" },
  engineType: { inboard: "inombordare", outboard: "utombordare", sterndrive: "drev", jet: "jet" },
  engineFuel: { petrol: "bensin", diesel: "diesel", electric: "el" },
  hoursSource: { mechanic: "mekaniker", customer: "kunden", ai: "AI" },
  customerType: {
    private: "Privatperson",
    marina: "Marina",
    club: "Klubb",
    rental: "Uthyrning",
    yard: "Varv",
  },
  ownershipRole: { owner: "Ägare", co_owner: "Delägare", contact: "Kontaktperson" },
  boatStatus: { active: "Aktiv", sold: "Såld" },
  placementMode: { water: "i sjön", land: "på land", indoor: "inomhus" },
  language: { sv: "Svenska", en: "Engelska" },
  visitStatus: {
    tentative: "Preliminär",
    reserved: "Reserverad",
    pending_approval: "Väntar på godkännande",
    booked: "Bokad",
    confirmed: "Bekräftad",
    unconfirmed: "Obekräftad",
    in_progress: "Pågår",
    done: "Utfört",
    cancelled: "Avbokad",
    no_access: "Båten ej tillgänglig",
  },
  tasks: {
    title: "Ärenden",
    none: "Inga öppna ärenden.",
    take: "Jag tar det",
    done: "Klart",
    takenBy: (name: string) => `${name} har tagit det`,
    callBack: "Ring upp",
    due: (time: string) => `Svar senast ${time}`,
    urgent: "Brådskande",
    open: (n: number) => (n === 1 ? "1 öppet ärende" : `${String(n)} öppna ärenden`),
    call: "Samtalet",
    gone: "Ärendet är redan klart eller finns inte.",
    push: {
      on: "Slå på aviseringar",
      active: "Aviseringar är på för den här telefonen.",
      blocked: "Aviseringar är avstängda i webbläsarens inställningar.",
      unsupported:
        "Den här webbläsaren kan inte ta emot aviseringar. Lägg Bojen på hemskärmen först.",
      failed: "Det gick inte att slå på aviseringar.",
    },
    /** Titles of the tasks the receptionist leaves (spec 8.4). */
    called: (label: string | null, who: string) => `${label ? `${label}: ` : ""}${who} ringde`,
    voicemail: (who: string) => `Röstmeddelande från ${who}`,
    unknownCaller: "Okänt nummer",
    customer: "Kund",
    wanted: (reason: string) => `Ville kopplas: ${reason}`,
    transferred: (name: string) => `Kopplad till ${name}`,
    notTransferred: "Ingen svarade när samtalet kopplades.",
    emptyVoicemail: "(Inget hördes i röstmeddelandet.)",
    untranscribed: "(Röstmeddelandet kunde inte skrivas ut. Ring upp kunden.)",
  },
  message: {
    channel: { sms: "Sms", email: "E-post", push: "Push" },
    direction: { inbound: "Från kunden", outbound: "Till kunden" },
    status: {
      queued: "Köad",
      sent: "Skickad",
      delivered: "Levererad",
      failed: "Misslyckades",
      received: "Mottagen",
      blocked: "Ej skickad",
    },
    intent: {
      yes: "tolkat som ja",
      no: "tolkat som nej",
      change: "vill ändra",
      other: "annat",
      stop: "STOPP",
      another_time: "annan tid",
      rating: "betyg",
      sold: "båten såld",
      call_me: "vill bli uppringd",
      info: "information",
      unclear: "oklart",
    },
    /** What each template is, in a word or two. An unknown template shows as a message. */
    template: {
      f1_confirmation: "Bokningsbekräftelse",
      f2_tentative: "Preliminär bokning",
      f2_parts_arrived: "Delarna har kommit",
      f3_check_water: "Tillgänglighetskontroll",
      f3_check_water_code: "Tillgänglighetskontroll",
      f3_check_land: "Tillgänglighetskontroll",
      f3_check_land_code: "Tillgänglighetskontroll",
      f3_reply_yes: "Kvittens på kontroll",
      f3_reply_no: "Kvittens på avbokning",
      f3_reply_change: "Kvittens på ändring",
      f3_reminder: "Påminnelse om kontroll",
      f4_offer: "Erbjudande om ledig tid",
      f4_taken: "Tiden är tagen",
      f5_eta: "Ankomsttid",
      f6_on_way: "Mekanikern är på väg",
      f7_report: "Servicerapport",
      f8_payment_reminder: "Betalningspåminnelse",
      f9_survey: "Nöjdhetsfråga",
      f9_reply_good: "Tack för bra betyg",
      f9_reply_poor: "Svar på lågt betyg",
      f10_next_season: "Nästa säsong",
      f11_spring_a: "Vårkampanj",
      f11_spring_discount: "Vårkampanj med rabatt",
      f11_spring_b: "Vårkampanj",
      f11_sold_question: "Fråga om såld båt",
      f11_other_times: "Länk till andra tider",
      f12_autumn: "Höstkampanj",
      f12_haulout_question: "Fråga om upptagning",
      f13_service_reminder: "Påminnelse om service",
      f14_received: "Akutärende mottaget",
      f14_taken: "Akutärende taget",
      f14_none_available: "Ingen mekaniker ledig",
      f14_moved: "Akutärende flyttat",
      f15_type_plate: "Be om bild på typskylt",
      voice_booking_link: "Länk till bokningen",
      voice_access_link: "Länk för koder",
      voice_pictures_link: "Länk för bilder",
      voice_message_soon: "Svar inom 30 minuter",
      voice_message_promise: "Svarslöfte",
      voice_first_time: "Första lediga tid",
      staff_alert: "Avisering till mekaniker",
      stop_receipt: "Kvitto på STOPP",
    } as Record<string, string>,
    inboundFallback: "Svar",
    outboundFallback: "Meddelande",
  },
} as const;
