/**
 * The system prompt of spec 8.2, from `prompts/system.sv.md` with the firm's facts filled in.
 * The firm's part is the same for every call and is cached; the caller's context comes last
 * and changes per call (spec 8.2: "Kundkontexten läggs sist i prompten").
 */
import { readFileSync } from "node:fs";

/** What the call start gives about the firm (`ReceptionistFacts` in packages/db). */
export interface FirmFacts {
  firma: string;
  assistentNamn: string;
  halsning: string | null;
  mekaniker: string;
  serviceomrade: string;
  ejServiceomraden: string[];
  oppettider: string;
  jourtider: string;
  svarslofte: string;
  timpris: number | null;
  akuttillagg: number | null;
  tjanster: {
    id: string;
    namn: string;
    minuter: number;
    krav: string | null;
    pris: number | null;
  }[];
  platser: { id: string; namn: string; typ: string }[];
}

export const PROMPT_FILE = new URL("../prompts/system.sv.md", import.meta.url);

const MODE: Record<string, string> = { water: "i sjön", land: "på land", indoor: "inomhus" };

/** The first line, word for word (spec 8.2), said by the system before the model answers. */
export function firstLine(f: FirmFacts): string {
  const hello = f.halsning ?? `Hej och välkommen till ${f.firma}`;
  return `${hello}. Jag är ${f.firma}s digitala assistent, och samtalet spelas in så att vi kan hjälpa dig. Vad gäller det?`;
}

/** The firm's part of the prompt, with every placeholder filled. */
export function stablePrompt(f: FirmFacts, template = readFileSync(PROMPT_FILE, "utf8")): string {
  const prices = f.tjanster
    .filter((s) => s.pris !== null)
    .map((s) => `${s.namn}: ${String(s.pris)} kronor exklusive moms`);
  const values: Record<string, string> = {
    assistentNamn: f.assistentNamn,
    firma: f.firma,
    mekaniker: f.mekaniker,
    serviceomrade: f.serviceomrade,
    forstaReplik: firstLine(f),
    prislista:
      prices.length > 0
        ? prices.join("\n")
        : "Ingen prislista. Säg att mekanikern återkommer med pris.",
    akutregler:
      f.akuttillagg !== null
        ? `${String(f.akuttillagg)} kronor plus ordinarie timpris`
        : "enligt överenskommelse med mekanikern",
    timpris: f.timpris !== null ? String(f.timpris) : "enligt prislistan",
    ejServiceomraden:
      f.ejServiceomraden.length > 0 ? f.ejServiceomraden.join(", ") : "inga undantag",
    svarslofte: f.svarslofte,
    oppettider: f.oppettider,
    jourtider: f.jourtider,
    tjanster: f.tjanster
      .map(
        (s) =>
          `${s.id}: ${s.namn}, ${String(s.minuter)} minuter${s.krav ? `, båten ska vara ${MODE[s.krav] ?? s.krav}` : ""}`,
      )
      .join("\n"),
    platser: f.platser.map((p) => `${p.id}: ${p.namn}`).join("\n"),
  };
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** The caller's part: the customer context from the call start, as data for the model. */
export function contextPrompt(context: unknown): string {
  return `# Kundkontext (från systemet, ändras per samtal)\n${JSON.stringify(context)}`;
}
