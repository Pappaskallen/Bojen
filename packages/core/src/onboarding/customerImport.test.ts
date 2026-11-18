import { describe, expect, it } from "vitest";
import { crm } from "../i18n/sv";
import {
  IMPORT_COLUMNS,
  importReady,
  importTemplate,
  parseCustomerSheet,
  seasonDates,
  type Cell,
  type ImportColumn,
} from "./customerImport";

const BULLANDO = { id: "loc-bullando", name: "Bullandö Marina" };
const VARV = { id: "loc-varv", name: "Stavsnäs Vinterförvaring" };
const header = IMPORT_COLUMNS.map((key) => crm.customerImport.columns[key]);
const row = (values: Partial<Record<ImportColumn, Cell>>): Cell[] =>
  IMPORT_COLUMNS.map((key) => values[key] ?? null);
const parse = (...rows: Cell[][]) => parseCustomerSheet([header, ...rows], [BULLANDO, VARV]);

describe("the customer import", () => {
  it("reads the template's own examples without a problem", () => {
    const { data } = importTemplate();
    const plan = parseCustomerSheet(data, [BULLANDO]);
    expect(plan.problems).toEqual([]);
    expect(plan.rows).toBe(3);
    expect(plan.customers.map((c) => [c.name, c.boats.length])).toEqual([
      ["Anna Exempelsson", 2],
      ["Saltsjö Exempelklubb", 0],
    ]);
    const [anna, club] = plan.customers;
    expect(anna).toMatchObject({
      phone: "+46701740605",
      email: "anna@example.se",
      marketingSms: true,
      type: "private",
    });
    expect(anna?.boats[0]).toMatchObject({
      row: 2,
      name: "Sjöbris",
      make: "Nimbus",
      lengthM: "9.6",
      year: 2008,
      engine: {
        make: "Volvo Penta",
        type: "inboard",
        fuel: "diesel",
        hours: 1240,
        modelYear: 2008,
      },
      summer: { locationId: "loc-bullando", spotId: "B14" },
      winter: { locationId: "loc-bullando", mode: "land" },
      launchDate: "2027-04-24",
      haulOutDate: "2027-10-16",
    });
    expect(anna?.boats[1]?.engine).toMatchObject({ type: "outboard", fuel: "petrol" });
    expect(club).toMatchObject({ type: "club", phone: "+46812345678", marketingSms: false });
    expect(importReady(plan)).toBe(true);
  });

  it("finds the header below a title and takes the columns in any order", () => {
    const plan = parseCustomerSheet(
      [
        ["Mina kunder 2026"],
        [],
        ["Mobil", "kundnamn ", "Båtmärke"],
        ["0701740606", "Bo Båtsson", "Linder"],
      ],
      [],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.customers[0]).toMatchObject({ row: 4, name: "Bo Båtsson", phone: "+46701740606" });
    expect(plan.customers[0]?.boats[0]?.make).toBe("Linder");
  });

  it("puts back the zero Excel drops from a mobile number, and reads Excel's dates", () => {
    const plan = parse(
      row({
        name: "Cilla",
        phone: 701740607,
        boatMake: "Ryds",
        launchDate: new Date("2027-05-01T00:00:00Z"),
        lengthM: "5,5",
      }),
    );
    expect(plan.problems).toEqual([]);
    expect(plan.customers[0]?.phone).toBe("+46701740607");
    expect(plan.customers[0]?.boats[0]).toMatchObject({ launchDate: "2027-05-01", lengthM: "5.5" });
  });

  it("names the row and the column of every mistake, and is then not ready", () => {
    const plan = parse(
      row({ phone: "0701740608" }),
      row({ name: "Dan", phone: "12345" }),
      row({ name: "Eva" }),
      row({ name: "Fia", email: "fia@", boatMake: "Nimbus", engineType: "ånga", hours: "många" }),
      row({ name: "Gun", phone: "0701740609", boatMake: "Nimbus", summerPlace: "Okänd hamn" }),
      row({
        name: "Hans",
        phone: "0701740610",
        boatModel: "26",
        launchDate: "24 april",
        boatYear: 85,
      }),
      row({ name: "Ida", phone: "0701740611", marketingSms: "kanske" }),
    );
    expect(plan.problems.map((p) => [p.row, p.message])).toEqual([
      [2, "Kundnamn saknas."],
      [3, "12345 är inget giltigt telefonnummer."],
      [4, "Mobil eller e-post krävs."],
      [5, "fia@ är ingen giltig e-postadress."],
      [5, "Motortyp: ånga är inget av inombordare, utombordare, drev, jet."],
      [5, "Motortimmar: många är inget tal."],
      [6, "Plats sommar: platsen Okänd hamn finns inte. Lägg in den under Marinor först."],
      [7, "Båten saknar både namn och märke."],
      [7, "Årsmodell: 85 är inget årtal."],
      [7, "Sjösättning: 24 april är inget datum. Skriv till exempel 2027-04-24."],
      [8, "Erbjudanden per sms: kanske är inget av ja, nej."],
    ]);
    expect(plan.problems.every((p) => p.level === "error")).toBe(true);
    expect(plan.customers).toEqual([]);
    expect(importReady(plan)).toBe(false);
  });

  it("gathers a customer's boats and warns when the rows disagree", () => {
    const plan = parse(
      row({
        name: "Jan Jansson",
        phone: "070-174 06 12",
        email: "jan@example.se",
        boatMake: "Nimbus",
      }),
      row({ name: "Jan Jansson", phone: "0701740612", boatMake: "Buster" }),
      row({
        name: "Janne J",
        phone: "+46 70 174 06 12",
        email: "janne@example.se",
        boatMake: "Ryds",
      }),
    );
    expect(plan.customers).toHaveLength(1);
    expect(plan.customers[0]?.boats.map((b) => b.make)).toEqual(["Nimbus", "Buster", "Ryds"]);
    expect(plan.customers[0]?.email).toBe("jan@example.se");
    expect(plan.problems).toEqual([
      {
        row: 4,
        level: "warning",
        message: "Samma mobil eller e-post som rad 2, men ett annat namn (Jan Jansson).",
      },
      {
        row: 4,
        level: "warning",
        message: "E-post skiljer sig från rad 2. Värdet från rad 2 används.",
      },
    ]);
    expect(importReady(plan)).toBe(true);
  });

  it("says so when the header row is missing, and skips empty rows", () => {
    const missing = parseCustomerSheet([["Namn", "Telefon"]], []);
    expect(missing.problems[0]?.message).toBe(
      "Hittar inte raden med kolumnnamn. Den ska börja med Kundnamn.",
    );
    const plan = parse([], row({}), row({ name: "Kim", email: "kim@example.se" }), ["  "]);
    expect(plan.rows).toBe(1);
    expect(plan.customers[0]).toMatchObject({ row: 4, phone: null, email: "kim@example.se" });
  });

  it("has help for every column in the template", () => {
    const { help } = importTemplate();
    const titles = help.slice(3).map((r) => r[0]);
    expect(titles).toEqual(header);
    expect(help.find((r) => r[0] === "Kundnamn")?.[1]).toBe("Ja");
    expect(help.find((r) => r[0] === "Vinterläge")?.[3]).toBe("på land, inomhus, i sjön");
  });
});

describe("seasonDates", () => {
  it("gives the summer after the launch and the winter that ends at it", () => {
    expect(seasonDates("2027-04-24", "2027-10-16")).toEqual({
      summer: { launchDate: "2027-04-24", haulOutDate: "2027-10-16" },
      winter: { launchDate: "2027-04-24", haulOutDate: "2026-10-16" },
    });
    expect(seasonDates("2027-04-24", "2026-10-16")).toEqual({
      summer: { launchDate: "2027-04-24", haulOutDate: "2027-10-16" },
      winter: { launchDate: "2027-04-24", haulOutDate: "2026-10-16" },
    });
    expect(seasonDates(null, "2026-10-16").winter).toEqual({
      launchDate: null,
      haulOutDate: "2026-10-16",
    });
  });
});
