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
      smsCode: (code: string, firm: string) => `${code} är din kod för att boka hos ${firm}.`,
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
} as const;

export type Texts = typeof sv;
