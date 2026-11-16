/**
 * A picture of an engine's type plate read into make, model and serial number (byggplan
 * step 6.3, spec F15). Pure: the reading itself comes from Claude Sonnet 5.5 through the
 * `NameplateReader` port. The mechanic confirms a suggestion before the boat card changes.
 */

/** Marine engine makes as the firm writes them; the model's spelling is mapped onto these. */
export const NAMEPLATE_MAKES = [
  "Volvo Penta",
  "Mercury",
  "MerCruiser",
  "Yamaha",
  "Suzuki",
  "Honda",
  "Evinrude",
  "Johnson",
  "Tohatsu",
  "Yanmar",
  "Nanni",
  "Vetus",
  "Beta Marine",
  "Cummins",
  "Caterpillar",
  "MAN",
  "Perkins",
  "Mercedes-Benz",
] as const;

export interface NameplateReading {
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  /** 0–1, how sure the model is that it read a type plate right. */
  confidence: number;
}

/** Below this the reading is not shown as a suggestion; the mechanic looks at the picture. */
export const SUGGEST_FROM = 0.5;

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The firm's spelling of a make, or the model's own when it is not a known one. */
export function canonicalMake(make: string): string {
  const f = fold(make);
  if (!f) return make.trim();
  // "Penta" alone and "Volvo" alone on a plate are Volvo Penta.
  if (f === "volvo" || f === "penta" || f === "volvopenta") return "Volvo Penta";
  if (f === "mercurymarine") return "Mercury";
  if (f === "mercruiser" || f === "mercurymercruiser") return "MerCruiser";
  return NAMEPLATE_MAKES.find((m) => fold(m) === f) ?? make.trim();
}

const text = (v: unknown, max = 80) =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The model's answer made safe to show: trimmed, the make in the firm's spelling. */
export function normaliseNameplate(raw: unknown): NameplateReading {
  const r = isRecord(raw) ? raw : {};
  const make = text(r.make);
  const confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : 0;
  return {
    make: make ? canonicalMake(make) : null,
    model: text(r.model),
    serialNumber: text(r.serialNumber, 60)?.replace(/\s+/g, "") ?? null,
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

/** Whether the reading is worth suggesting to the mechanic. */
export const worthSuggesting = (r: NameplateReading) =>
  r.confidence >= SUGGEST_FROM && Boolean(r.make ?? r.model);

/**
 * Whether a reading names the model the plate really has, for the test with real plates:
 * the same make, and the model the same once spaces, hyphens and case are set aside, or one
 * of them the start of the other ("D4-300" and "D4-300A").
 */
export function sameModel(reading: NameplateReading, expected: { make: string; model: string }) {
  if (!reading.make || !reading.model) return false;
  if (fold(canonicalMake(reading.make)) !== fold(canonicalMake(expected.make))) return false;
  const a = fold(reading.model);
  const b = fold(expected.model);
  return a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));
}
