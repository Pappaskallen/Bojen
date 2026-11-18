/**
 * The customer import from the command line (Avslutande kontroll, onboarding):
 *
 *   pnpm db:import mall [fil.xlsx]                     the empty template
 *   pnpm db:import kunder --firma <slug> <fil.xlsx>     check the list, save nothing
 *   pnpm db:import kunder --firma <slug> <fil.xlsx> --spara   save it, if it has no errors
 *
 * Checking first is the default, so a list is never half saved: every row with a mistake is
 * named, the list is fixed in Excel and read again.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { importReady, parseCustomerSheet } from "@bojen/core/onboarding";
import { connect } from "./client";
import { databaseUrl } from "./config";
import { importPlaces, saveCustomerImport } from "./customer-import";
import { readImportFile, templateXlsx } from "./import-xlsx";
import { findFirm } from "./public-booking";

const USAGE = [
  "pnpm db:import mall [fil.xlsx]",
  "pnpm db:import kunder --firma <slug> <fil.xlsx> [--spara]",
].join("\n");

/** A path as the user typed it: pnpm runs the script in packages/db, not where it was started. */
const here = (file: string) => resolve(process.env.INIT_CWD ?? process.cwd(), file);

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === "mall") {
    const file = here(rest[0] ?? "importmall-kunder.xlsx");
    await writeFile(file, await templateXlsx());
    console.info(`Mallen är sparad i ${file}.`);
    return 0;
  }
  if (command !== "kunder") {
    console.error(USAGE);
    return 2;
  }

  const firmAt = rest.indexOf("--firma");
  const slug = firmAt >= 0 ? rest[firmAt + 1] : undefined;
  const save = rest.includes("--spara");
  const file = rest.find((a, i) => !a.startsWith("--") && i !== firmAt + 1);
  if (!slug || !file) {
    console.error(USAGE);
    return 2;
  }

  const { db, close } = connect(databaseUrl());
  try {
    const firm = await findFirm(db, slug);
    if (!firm) {
      console.error(`Hittar ingen firma med adressen ${slug}.`);
      return 1;
    }
    const plan = parseCustomerSheet(
      await readImportFile(here(file)),
      await importPlaces(db, firm.tenantId),
    );
    const boats = plan.customers.reduce((n, c) => n + c.boats.length, 0);
    console.info(
      `${firm.name}: ${String(plan.rows)} rader, ${String(plan.customers.length)} kunder och ${String(boats)} båtar.`,
    );
    for (const p of plan.problems) {
      console.info(`  Rad ${String(p.row)}: ${p.level === "error" ? "FEL" : "obs"} – ${p.message}`);
    }
    if (!importReady(plan)) {
      console.info("Rätta felen i filen och läs in den igen. Inget är sparat.");
      return 1;
    }
    if (!save) {
      console.info("Listan går att spara. Kör samma kommando med --spara.");
      return 0;
    }
    const result = await saveCustomerImport(db, firm.tenantId, plan, new Date());
    console.info(
      `Sparat: ${String(result.customers)} kunder, ${String(result.boats)} båtar, ${String(result.engines)} motorer och ${String(result.placements)} platser.`,
    );
    for (const s of result.skipped) {
      console.info(`  Rad ${String(s.row)}: fanns redan i kundregistret och lämnades som den var.`);
    }
    return 0;
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
