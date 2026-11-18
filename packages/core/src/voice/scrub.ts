/**
 * Card and personal identity numbers out of a call's transcript before it is saved (spec
 * 10.5, byggplan step 6.3). Pattern matching, careful about phone numbers: a Swedish mobile
 * (0701234567) looks like a personal number without its hyphen, so a personal number is
 * only taken with its hyphen or plus, or with the century in twelve digits.
 */

export const CARD_MARK = "[kortnummer]";
export const PERSONAL_NUMBER_MARK = "[personnummer]";

/** The Luhn check that card numbers and personal numbers both carry. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const validDate = (yy: string, mm: string, dd: string) => {
  const month = Number(mm);
  // Coordination numbers add 60 to the day.
  const day = Number(dd) > 60 ? Number(dd) - 60 : Number(dd);
  void yy;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
};

/** 13–19 digits, maybe in groups with spaces or hyphens, that pass the Luhn check. */
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
/** YYMMDD-XXXX, YYMMDD+XXXX, YYYYMMDD-XXXX or YYYYMMDDXXXX. */
const PERSONAL =
  /\b(?:(19|20)(\d{2})(\d{2})(\d{2})[-+]?(\d{4})|(\d{2})(\d{2})(\d{2})[-+](\d{4}))\b/g;

/** The transcript with card and personal numbers replaced by a mark. */
export function scrubSensitive(text: string): string {
  const withoutPersonal = text.replace(
    PERSONAL,
    (
      whole,
      century: string | undefined,
      y1: string,
      m1: string,
      d1: string,
      n1: string,
      y2: string,
      m2: string,
      d2: string,
      n2: string,
    ) => {
      const [yy, mm, dd, nnnn] = century ? [y1, m1, d1, n1] : [y2, m2, d2, n2];
      if (!yy || !mm || !dd || !nnnn || !validDate(yy, mm, dd)) return whole;
      return PERSONAL_NUMBER_MARK;
    },
  );
  return withoutPersonal.replace(CARD, (whole) => {
    const digits = whole.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? CARD_MARK : whole;
  });
}
