/**
 * How many sms segments a text costs (byggplan step 3.1).
 *
 * GSM-7 holds 160 characters in one sms and 153 per segment when split. The extension
 * characters (`^ { } \ [ ~ ] | €`) take two places and are never split across segments.
 * Å, ä and ö are part of GSM-7. One character outside it makes the whole text UCS-2:
 * 70 code units in one sms, 67 per segment, where an emoji takes two and is never split.
 */
const GSM7_BASIC = new Set(
  [
    "@£$¥èéùìòÇ\nØø\rÅå",
    "Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ",
    " !\"#¤%&'()*+,-./",
    "0123456789:;<=>?",
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§",
    "¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ]
    .join("")
    .split(""),
);
const GSM7_EXTENSION = new Set("^{}\\[~]|€\f".split(""));

export type SmsEncoding = "gsm7" | "ucs2";

export interface SegmentCount {
  encoding: SmsEncoding;
  segments: number;
  /** Characters as the phone counts them: septets for GSM-7, code units for UCS-2. */
  units: number;
}

export function isGsm7(text: string): boolean {
  for (const c of text) if (!GSM7_BASIC.has(c) && !GSM7_EXTENSION.has(c)) return false;
  return true;
}

/** Places split segments greedily, never cutting a character that takes two places. */
function pack(sizes: number[], single: number, perSegment: number): number {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return 1;
  if (total <= single) return 1;
  let segments = 1;
  let used = 0;
  for (const size of sizes) {
    if (used + size > perSegment) {
      segments += 1;
      used = 0;
    }
    used += size;
  }
  return segments;
}

export function countSegments(text: string): SegmentCount {
  const chars = [...text];
  if (isGsm7(text)) {
    const sizes = chars.map((c) => (GSM7_EXTENSION.has(c) ? 2 : 1));
    return {
      encoding: "gsm7",
      units: sizes.reduce((a, b) => a + b, 0),
      segments: pack(sizes, 160, 153),
    };
  }
  const sizes = chars.map((c) => c.length);
  return {
    encoding: "ucs2",
    units: sizes.reduce((a, b) => a + b, 0),
    segments: pack(sizes, 70, 67),
  };
}

/**
 * Typographic characters that would force UCS-2, replaced by their GSM-7 look-alikes
 * (Robert's choice in step 3.1): `08–12` becomes `08-12`, so most sms fit in one segment.
 */
const LOOK_ALIKES: Record<string, string> = {
  "–": "-", // en dash
  "—": "-", // em dash
  "−": "-", // minus
  "”": '"',
  "“": '"',
  "„": '"',
  "’": "'",
  "‘": "'",
  "…": "...",
  " ": " ", // no-break space
  " ": " ", // narrow no-break space
};

export function toSmsCharacters(text: string): string {
  let out = "";
  for (const c of text) out += LOOK_ALIKES[c] ?? c;
  return out;
}
