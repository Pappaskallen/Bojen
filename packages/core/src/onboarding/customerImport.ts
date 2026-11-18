/**
 * Reading a new firm's customer list from Excel (Avslutande kontroll, onboarding; spec 12 and
 * risk R4). The template has one row per boat; rows with the same mobile number (or e-mail,
 * when there is no mobile) are one customer. Everything is checked before anything is saved,
 * and every problem names its row in the sheet, so the list can be fixed and read again.
 *
 * Pure: the cells come in, a plan comes out. Reading the file and saving the plan happen in
 * `@bojen/db`.
 */
import { toE164 } from "../contact/phone";
import { crm } from "../i18n/sv";

export type Cell = string | number | boolean | Date | null | undefined;

const texts = crm.customerImport;

/** The template's columns, in the template's order. */
export const IMPORT_COLUMNS = [
  "name",
  "phone",
  "email",
  "type",
  "billingAddress",
  "marketingSms",
  "boatName",
  "boatMake",
  "boatModel",
  "boatYear",
  "lengthM",
  "registration",
  "engineMake",
  "engineModel",
  "engineType",
  "fuel",
  "engineYear",
  "serial",
  "hours",
  "summerPlace",
  "summerSpot",
  "winterPlace",
  "winterMode",
  "launchDate",
  "haulOutDate",
] as const satisfies readonly (keyof typeof texts.columns)[];

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** The columns a row cannot do without. */
export const REQUIRED_COLUMNS: readonly ImportColumn[] = ["name"];

type CustomerType = keyof typeof crm.customerType;
type EngineType = keyof typeof crm.engineType;
type EngineFuel = keyof typeof crm.engineFuel;
type PlacementMode = keyof typeof crm.placementMode;

/** The values a choice column takes, with the words people write for them. */
export const IMPORT_CHOICES = {
  type: {
    private: ["privatperson", "privat", "private"],
    marina: ["marina"],
    club: ["klubb", "båtklubb", "club"],
    rental: ["uthyrning", "rental"],
    yard: ["varv", "yard"],
  },
  engineType: {
    inboard: ["inombordare", "inombords", "inboard"],
    outboard: ["utombordare", "utombords", "outboard"],
    sterndrive: ["drev", "inombordare med drev", "sterndrive"],
    jet: ["jet"],
  },
  fuel: {
    petrol: ["bensin", "petrol"],
    diesel: ["diesel"],
    electric: ["el", "elektrisk", "electric"],
  },
  winterMode: {
    land: ["på land", "land", "uppställd"],
    indoor: ["inomhus", "inne", "hall"],
    water: ["i sjön", "sjön", "vatten", "i vattnet"],
  },
} as const satisfies {
  type: Record<CustomerType, readonly string[]>;
  engineType: Record<EngineType, readonly string[]>;
  fuel: Record<EngineFuel, readonly string[]>;
  winterMode: Record<PlacementMode, readonly string[]>;
};

/** A place in the firm's register that a row can name. */
export interface ImportPlace {
  id: string;
  name: string;
}

export interface ImportEngine {
  make: string | null;
  model: string | null;
  type: EngineType | null;
  fuel: EngineFuel | null;
  modelYear: number | null;
  serialNumber: string | null;
  hours: number | null;
}

export interface ImportBoat {
  /** The row in the sheet, counted as Excel does. */
  row: number;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  /** As numeric text for the database, for example "9.5". */
  lengthM: string | null;
  registrationNumber: string | null;
  engine: ImportEngine | null;
  summer: { locationId: string; spotId: string | null } | null;
  winter: { locationId: string; mode: PlacementMode } | null;
  /** Dates as YYYY-MM-DD. */
  launchDate: string | null;
  haulOutDate: string | null;
}

export interface ImportCustomer {
  row: number;
  name: string;
  /** E.164. */
  phone: string | null;
  email: string | null;
  type: CustomerType;
  billingAddress: string | null;
  /** Only when the firm can show the customer said yes. */
  marketingSms: boolean;
  boats: ImportBoat[];
}

export interface ImportProblem {
  row: number;
  level: "error" | "warning";
  message: string;
}

export interface ImportPlan {
  customers: ImportCustomer[];
  problems: ImportProblem[];
  /** Rows with something in them, below the header. */
  rows: number;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

function cellText(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  const text = String(cell).trim().replace(/\s+/g, " ");
  return text.length > 0 ? text : null;
}

/** Excel drops a leading zero from a number typed without quotes: 701234567 was 0701234567. */
function phoneText(cell: Cell): string | null {
  const text = cellText(cell);
  if (text === null) return null;
  return /^7\d{8}$/.test(text.replace(/[\s-]/g, "")) ? `0${text}` : text;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reads one sheet: the header row first (anywhere in the first ten rows), then the data. */
export function parseCustomerSheet(
  rows: readonly (readonly Cell[])[],
  places: ImportPlace[],
): ImportPlan {
  const problems: ImportProblem[] = [];
  const nameTitle = normalize(texts.columns.name);
  const headerIndex = rows
    .slice(0, 10)
    .findIndex((r) => r.some((c) => normalize(cellText(c) ?? "") === nameTitle));
  if (headerIndex < 0) {
    return {
      customers: [],
      rows: 0,
      problems: [
        {
          row: 1,
          level: "error",
          message: fill(texts.errors.noHeader, { column: texts.columns.name }),
        },
      ],
    };
  }

  const header = rows[headerIndex] ?? [];
  const position = new Map<ImportColumn, number>();
  for (const key of IMPORT_COLUMNS) {
    const title = normalize(texts.columns[key]);
    const at = header.findIndex((c) => normalize(cellText(c) ?? "") === title);
    if (at >= 0) position.set(key, at);
    else if (REQUIRED_COLUMNS.includes(key)) {
      problems.push({
        row: headerIndex + 1,
        level: "error",
        message: fill(texts.errors.missingColumn, { column: texts.columns[key] }),
      });
    }
  }

  const placeByName = new Map(places.map((p) => [normalize(p.name), p.id]));
  const customers = new Map<string, ImportCustomer>();
  let count = 0;

  rows.slice(headerIndex + 1).forEach((cells, i) => {
    const row = headerIndex + 2 + i;
    const raw = (key: ImportColumn): Cell => {
      const at = position.get(key);
      return at === undefined ? null : cells[at];
    };
    const value = (key: ImportColumn) => cellText(raw(key));
    if (IMPORT_COLUMNS.every((key) => value(key) === null)) return;
    count++;

    const errors: string[] = [];
    const title = (key: ImportColumn) => texts.columns[key];

    const choice = <K extends keyof typeof IMPORT_CHOICES>(key: K) => {
      const given = value(key);
      if (given === null) return null;
      const wanted = normalize(given);
      for (const [option, words] of Object.entries(IMPORT_CHOICES[key])) {
        if (option === wanted || (words as readonly string[]).includes(wanted)) {
          return option as keyof (typeof IMPORT_CHOICES)[K];
        }
      }
      const allowed = Object.values(IMPORT_CHOICES[key]).map(
        (words) => (words as readonly string[])[0],
      );
      errors.push(
        fill(texts.errors.choice, {
          column: title(key),
          value: given,
          allowed: allowed.join(", "),
        }),
      );
      return null;
    };
    const number = (key: ImportColumn): number | null => {
      const cell = raw(key);
      if (typeof cell === "number") return cell;
      const given = value(key);
      if (given === null) return null;
      const parsed = Number(given.replace(/\s/g, "").replace(",", "."));
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      errors.push(fill(texts.errors.number, { column: title(key), value: given }));
      return null;
    };
    const year = (key: ImportColumn): number | null => {
      const given = value(key);
      if (given === null) return null;
      const parsed = Number(given);
      if (Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2100) return parsed;
      errors.push(fill(texts.errors.year, { column: title(key), value: given }));
      return null;
    };
    const date = (key: ImportColumn): string | null => {
      const given = value(key);
      if (given === null) return null;
      const match = ISO_DATE.exec(given);
      const parsed = match ? new Date(`${given}T00:00:00Z`) : null;
      if (parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(given)) {
        return given;
      }
      errors.push(fill(texts.errors.date, { column: title(key), value: given }));
      return null;
    };
    const place = (key: ImportColumn): string | null => {
      const given = value(key);
      if (given === null) return null;
      const id = placeByName.get(normalize(given));
      if (!id) errors.push(fill(texts.errors.place, { column: title(key), value: given }));
      return id ?? null;
    };
    const yesNo = (key: ImportColumn): boolean => {
      const given = value(key);
      if (given === null) return false;
      const wanted = normalize(given);
      if ((texts.yes as readonly string[]).includes(wanted)) return true;
      if ((texts.no as readonly string[]).includes(wanted)) return false;
      errors.push(
        fill(texts.errors.choice, { column: title(key), value: given, allowed: "ja, nej" }),
      );
      return false;
    };

    // The customer.
    const name = value("name");
    if (name === null) errors.push(texts.errors.noName);
    const phoneGiven = phoneText(raw("phone"));
    const phone = phoneGiven === null ? null : toE164(phoneGiven);
    if (phoneGiven !== null && phone === null)
      errors.push(fill(texts.errors.phone, { value: phoneGiven }));
    const emailGiven = value("email");
    const email = emailGiven === null ? null : emailGiven.toLowerCase();
    if (email !== null && !EMAIL.test(email))
      errors.push(fill(texts.errors.email, { value: emailGiven ?? "" }));
    if (phoneGiven === null && emailGiven === null) errors.push(texts.errors.noContact);
    const type = choice("type") ?? "private";
    const billingAddress = value("billingAddress");
    const marketingSms = yesNo("marketingSms");

    // The boat, when the row has one.
    const boatColumns: ImportColumn[] = IMPORT_COLUMNS.slice(IMPORT_COLUMNS.indexOf("boatName"));
    let boat: ImportBoat | null = null;
    if (boatColumns.some((key) => value(key) !== null)) {
      const engineColumns: ImportColumn[] = [
        "engineMake",
        "engineModel",
        "engineType",
        "fuel",
        "engineYear",
        "serial",
        "hours",
      ];
      const engine: ImportEngine | null = engineColumns.some((key) => value(key) !== null)
        ? {
            make: value("engineMake"),
            model: value("engineModel"),
            type: choice("engineType"),
            fuel: choice("fuel"),
            modelYear: year("engineYear"),
            serialNumber: value("serial"),
            hours: number("hours"),
          }
        : null;
      const length = number("lengthM");
      const summerId = place("summerPlace");
      const winterId = place("winterPlace");
      const winterMode = choice("winterMode") ?? "land";
      if (value("boatName") === null && value("boatMake") === null)
        errors.push(texts.errors.boatWithoutMake);
      boat = {
        row,
        name: value("boatName"),
        make: value("boatMake"),
        model: value("boatModel"),
        year: year("boatYear"),
        lengthM: length === null ? null : String(Math.round(length * 100) / 100),
        registrationNumber: value("registration"),
        engine,
        summer: summerId ? { locationId: summerId, spotId: value("summerSpot") } : null,
        winter: winterId ? { locationId: winterId, mode: winterMode } : null,
        launchDate: date("launchDate"),
        haulOutDate: date("haulOutDate"),
      };
    }

    if (errors.length > 0) {
      for (const message of errors) problems.push({ row, level: "error", message });
      return;
    }

    const key = phone ?? email ?? normalize(name ?? "");
    const known = customers.get(key);
    if (!known) {
      customers.set(key, {
        row,
        name: name ?? "",
        phone,
        email,
        type,
        billingAddress,
        marketingSms,
        boats: boat ? [boat] : [],
      });
      return;
    }
    // Another row for a customer already read: the boat is added, the customer stays as first read.
    if (normalize(known.name) !== normalize(name ?? "")) {
      problems.push({
        row,
        level: "warning",
        message: fill(texts.errors.otherName, { row: known.row, name: known.name }),
      });
    }
    const differs: [ImportColumn, unknown, unknown][] = [
      ["email", known.email, email],
      ["type", known.type, type],
      ["billingAddress", known.billingAddress, billingAddress],
      ["marketingSms", known.marketingSms, marketingSms],
    ];
    for (const [column, first, now] of differs) {
      // A blank on a later row is no disagreement.
      const given =
        column === "marketingSms"
          ? now === true
          : column === "type"
            ? value("type") !== null
            : now !== null;
      if (given && first !== now) {
        problems.push({
          row,
          level: "warning",
          message: fill(texts.errors.otherDetails, { column: title(column), row: known.row }),
        });
      }
    }
    if (boat) known.boats.push(boat);
  });

  return { customers: [...customers.values()], problems, rows: count };
}

/** Whether the plan may be saved: not with a single error left. */
export const importReady = (plan: ImportPlan) => !plan.problems.some((p) => p.level === "error");

/** What the template says about each column: required or not, and what may be written. */
function allowedValues(column: ImportColumn): string {
  if (column === "marketingSms") return "ja, nej";
  if (column in IMPORT_CHOICES) {
    return Object.values(IMPORT_CHOICES[column as keyof typeof IMPORT_CHOICES])
      .map((words) => (words as readonly string[])[0])
      .join(", ");
  }
  return "";
}

/** Two made-up customers (numbers from PTS' range for fiction); one has two boats. */
const EXAMPLES: Partial<Record<ImportColumn, string | number>>[] = [
  {
    name: "Anna Exempelsson",
    phone: "070-174 06 05",
    email: "anna@example.se",
    marketingSms: "ja",
    boatName: "Sjöbris",
    boatMake: "Nimbus",
    boatModel: "305 Coupé",
    boatYear: 2008,
    lengthM: 9.6,
    engineMake: "Volvo Penta",
    engineModel: "D4-260",
    engineType: "inombordare",
    fuel: "diesel",
    engineYear: 2008,
    hours: 1240,
    summerPlace: "Bullandö Marina",
    summerSpot: "B14",
    winterPlace: "Bullandö Marina",
    winterMode: "på land",
    launchDate: "2027-04-24",
    haulOutDate: "2027-10-16",
  },
  {
    name: "Anna Exempelsson",
    phone: "070-174 06 05",
    boatMake: "Buster",
    boatModel: "M2",
    engineMake: "Yamaha",
    engineModel: "F60",
    engineType: "utombordare",
    fuel: "bensin",
    summerPlace: "Bullandö Marina",
  },
  {
    name: "Saltsjö Exempelklubb",
    phone: "08-123 456 78",
    email: "kansli@example.se",
    type: "klubb",
    billingAddress: "Bryggvägen 1, 133 00 Saltsjöbaden",
  },
];

/** The template's two sheets as rows of text and numbers, ready for an .xlsx writer. */
export function importTemplate(): {
  data: (string | number | null)[][];
  help: string[][];
} {
  const data = [
    IMPORT_COLUMNS.map((key) => texts.columns[key]),
    ...EXAMPLES.map((example) => IMPORT_COLUMNS.map((key) => example[key] ?? null)),
  ];
  const help = [
    [texts.help.intro],
    [],
    [...texts.help.headers],
    ...IMPORT_COLUMNS.map((key) => [
      texts.columns[key],
      REQUIRED_COLUMNS.includes(key) ? texts.help.required : texts.help.optional,
      texts.help[key],
      allowedValues(key),
    ]),
  ];
  return { data, help };
}

const shiftYear = (date: string, years: number) =>
  `${String(Number(date.slice(0, 4)) + years).padStart(4, "0")}${date.slice(4)}`;

/**
 * The two placements' dates from one launch and one haul-out. The summer runs from launch to
 * haul-out and the winter from haul-out to launch, and the database will not take a range that
 * ends before it starts: so the summer ends at the haul-out after the launch, and the winter
 * is the one that ends at the launch (it began at the haul-out the year before).
 */
export function seasonDates(launchDate: string | null, haulOutDate: string | null) {
  if (launchDate === null || haulOutDate === null) {
    const both = { launchDate, haulOutDate };
    return { summer: both, winter: both };
  }
  return {
    summer: {
      launchDate,
      haulOutDate: haulOutDate > launchDate ? haulOutDate : shiftYear(haulOutDate, 1),
    },
    winter: {
      launchDate,
      haulOutDate: haulOutDate < launchDate ? haulOutDate : shiftYear(haulOutDate, -1),
    },
  };
}
