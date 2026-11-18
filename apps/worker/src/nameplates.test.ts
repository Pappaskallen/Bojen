import { createFakeNameplateReader } from "@bojen/adapters";
import { describe, expect, it } from "vitest";
import { scorePlates } from "./nameplates";

const FACIT = [
  { file: "volvo.jpg", make: "Volvo Penta", model: "D4-300" },
  { file: "mercury.jpg", make: "Mercury", model: "F150" },
  { file: "yamaha.png", make: "Yamaha", model: "F115" },
  { file: "suzuki.jpg", make: "Suzuki", model: "DF140A" },
  { file: "honda.webp", make: "Honda", model: "BF100" },
];

describe("the test with real type plates", () => {
  it("passes at four of five right models, and fails below", async () => {
    // A fake that reads every plate as a Volvo Penta D4-300: one of five right.
    const once = await scorePlates(createFakeNameplateReader(), FACIT, () => new Uint8Array([1]));
    expect(once.right).toBe(1);
    expect(once.passed).toBe(false);
    expect(once.results[0]).toEqual({
      file: "volvo.jpg",
      expected: "Volvo Penta D4-300",
      read: "Volvo Penta D4-300",
      right: true,
    });

    const readings = new Map(FACIT.map((f) => [f.file, f]));
    let n = 0;
    const reader = {
      name: "fake",
      read: () => {
        const f = FACIT[n++];
        const facit = f ? readings.get(f.file) : undefined;
        // The last one is misread: four of five.
        return Promise.resolve(
          n === 5
            ? { make: "Honda", model: "BF60", serialNumber: null, confidence: 0.8 }
            : {
                make: facit?.make ?? null,
                model: facit?.model ?? null,
                serialNumber: null,
                confidence: 0.9,
              },
        );
      },
    };
    const four = await scorePlates(reader, FACIT, () => new Uint8Array([1]));
    expect(four).toMatchObject({ right: 4, passed: true });
  });

  it("only reads pictures the API can read", async () => {
    await expect(
      scorePlates(
        createFakeNameplateReader(),
        [{ file: "plate.heic", make: "Honda", model: "BF100" }],
        () => new Uint8Array([1]),
      ),
    ).rejects.toThrow(/jpg, png and webp/);
  });
});
