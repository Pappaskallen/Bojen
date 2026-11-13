/**
 * What the customer search of step 5.1 does with what the user types (spec C8). Pure: the
 * database layer turns the result into trigram-indexed `ILIKE` conditions.
 *
 * Every word must match something, in any field (name, phone, boat, engine, serial number,
 * marina), so "Per Nimbus" finds Per's Nimbus. A phone number typed in any way, "070-174 06
 * 86", "+46 70 174 06 86" or only a part of it, is one word and is matched against the stored
 * E.164 number.
 */

export const MAX_QUERY_LENGTH = 100;
export const MAX_TERMS = 6;
const MAX_TERM_LENGTH = 40;
/** Fewer digits than this are not a phone search: they would match nearly every number. */
const MIN_PHONE_DIGITS = 3;

export interface SearchTerm {
  /** The word as typed, for the text fields. */
  text: string;
  /** Digits to look for in the stored number (no plus sign), or null when it is not a number. */
  phone: string | null;
}

export type ParsedSearch = SearchTerm[];

/** Digits for the stored form `+46701740686`: 0701… and 0046701… both become 46701… */
export function phoneDigits(typed: string): string {
  const digits = typed.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `46${digits.slice(1)}`;
  return digits;
}

const ONLY_NUMBER = /^[+\d\s\-().]+$/;

function asPhone(text: string): string | null {
  if (!ONLY_NUMBER.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? phoneDigits(text) : null;
}

/** Splits a query into the words that must all match. Empty for an empty query. */
export function parseSearch(query: string): ParsedSearch {
  // Control characters count as spaces.
  const clean = Array.from(query, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (clean === "") return [];
  const limited = clean.slice(0, MAX_QUERY_LENGTH);

  // A number with spaces or dashes in it is one word.
  const whole = asPhone(limited);
  if (whole) return [{ text: limited, phone: whole }];

  return limited
    .split(" ")
    .slice(0, MAX_TERMS)
    .map((word) => word.slice(0, MAX_TERM_LENGTH))
    .filter((word) => word !== "")
    .map((word) => ({ text: word, phone: asPhone(word) }));
}

/** An `ILIKE` pattern that finds `text` anywhere, with `%` and `_` taken literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
