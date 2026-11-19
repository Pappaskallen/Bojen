/**
 * The firm in every simulated call (byggplan step 6.5): a made-up one-man firm in the
 * archipelago, with a price list so that the suite can tell a right price from a wrong one.
 */
import type { FirmFacts } from "../src/prompt";

export const EVAL_FIRM: FirmFacts = {
  firma: "Skärgårdens Båtservice",
  assistentNamn: "Bojen",
  halsning: null,
  mekaniker: "Jonas",
  serviceomrade: "Värmdö, Ingarö och Nacka",
  ejServiceomraden: ["Gotland", "Åland"],
  oppettider: "vardagar 7 till 17",
  jourtider: "dygnet runt under säsongen",
  svarslofte: "inom en arbetsdag",
  timpris: 950,
  akuttillagg: 1500,
  tjanster: [
    { id: "svc-var", namn: "Vårservice", minuter: 120, krav: null, pris: 2950 },
    {
      id: "svc-host",
      namn: "Höstservice och vinterförvaring",
      minuter: 150,
      krav: null,
      pris: 3450,
    },
    { id: "svc-felsok", namn: "Felsökning", minuter: 90, krav: null, pris: null },
    { id: "svc-balg", namn: "Bälgbyte", minuter: 240, krav: "land", pris: 6900 },
  ],
  platser: [
    { id: "loc-bullando", namn: "Bullandö Marina", typ: "marina" },
    { id: "loc-stavsnas", namn: "Stavsnäs Båtklubb", typ: "club" },
  ],
};

/** The mechanic's number, which the model must never hear (spec 8.4). */
export const MECHANIC_NUMBER = "+46701112233";

/** Every amount in kronor the receptionist may say, from the prompt and the tool answers. */
export const ALLOWED_AMOUNTS: readonly number[] = [
  ...EVAL_FIRM.tjanster.flatMap((s) => (s.pris === null ? [] : [s.pris])),
  EVAL_FIRM.timpris ?? 0,
  EVAL_FIRM.akuttillagg ?? 0,
  // The emergency charge plus the hourly rate, said as one sum.
  (EVAL_FIRM.akuttillagg ?? 0) + (EVAL_FIRM.timpris ?? 0),
];
