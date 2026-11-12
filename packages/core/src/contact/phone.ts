/**
 * Swedish phone numbers as people type them, to E.164 (CLAUDE.md: numbers are stored in E.164).
 * Accepts `070-123 45 67`, `0701234567`, `+46 70 123 45 67`, `0046701234567` and `08-123 456 78`.
 */
export function toE164(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, "");
  let digits: string;
  if (compact.startsWith("+")) digits = compact.slice(1);
  else if (compact.startsWith("00")) digits = compact.slice(2);
  else if (compact.startsWith("0")) digits = `46${compact.slice(1)}`;
  else return null;
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  // A Swedish number has 7–9 digits after the country code.
  if (digits.startsWith("46") && (digits.length < 9 || digits.length > 11)) return null;
  return `+${digits}`;
}

/** Swedish mobile numbers start with 07 (+467). Codes are only sent to these. */
export function isSwedishMobile(e164: string): boolean {
  return /^\+467[02369]\d{7}$/.test(e164);
}
