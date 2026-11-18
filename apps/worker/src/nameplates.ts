/**
 * The test with real type plates in byggplan step 6.3: "Tester med 5 riktiga typskyltsbilder
 * (Volvo Penta, Mercury, Yamaha, Suzuki och Honda) ger rätt modell i minst 4 av 5 fall."
 *
 *   pnpm --filter @bojen/worker nameplates <folder>
 *
 * The folder holds the pictures and `facit.json`: `[{ "file": "volvo.jpg", "make": "Volvo
 * Penta", "model": "D4-300" }, …]`. Claude Sonnet 5.5 reads each picture; this costs a
 * little and needs ANTHROPIC_API_KEY, so it is never part of the automatic tests.
 */
import { extname } from "node:path";
import { normaliseNameplate, sameModel, type NameplateReader } from "@bojen/core";

export interface Facit {
  file: string;
  make: string;
  model: string;
}

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export interface PlateResult {
  file: string;
  expected: string;
  read: string;
  right: boolean;
}

/** Reads every picture in the facit and says which models came out right. */
export async function scorePlates(
  reader: NameplateReader,
  facit: readonly Facit[],
  load: (file: string) => Uint8Array,
): Promise<{ results: PlateResult[]; right: number; passed: boolean }> {
  const results: PlateResult[] = [];
  for (const f of facit) {
    const contentType = TYPES[extname(f.file).toLowerCase()];
    if (!contentType) throw new Error(`${f.file}: only jpg, png and webp can be read`);
    const reading = normaliseNameplate(await reader.read({ bytes: load(f.file), contentType }));
    results.push({
      file: f.file,
      expected: `${f.make} ${f.model}`,
      read: [reading.make, reading.model].filter(Boolean).join(" ") || "–",
      right: sameModel(reading, f),
    });
  }
  const right = results.filter((r) => r.right).length;
  // At least four of five, as the step says; for another count, the same share.
  return { results, right, passed: right >= Math.ceil(facit.length * 0.8) };
}
