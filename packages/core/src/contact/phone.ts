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

/**
 * A stored number as Swedes write it: `+46701740601` is `070-174 06 01` and `+4686500400` is
 * `08-650 04 00`. Any other number is shown as stored: other area codes have two to four
 * digits and nothing here tells them apart.
 */
export function formatPhone(e164: string): string {
  const mobile = /^\+46(7[02369])(\d{3})(\d{2})(\d{2})$/.exec(e164);
  if (mobile) return `0${mobile[1] ?? ""}-${mobile[2] ?? ""} ${mobile[3] ?? ""} ${mobile[4] ?? ""}`;
  const stockholm = /^\+468(\d{6,8})$/.exec(e164);
  if (stockholm) {
    const n = stockholm[1] ?? "";
    const groups = n.length === 8 ? [3, 3, 2] : n.length === 7 ? [3, 2, 2] : [2, 2, 2];
    const parts: string[] = [];
    let at = 0;
    for (const size of groups) {
      parts.push(n.slice(at, at + size));
      at += size;
    }
    return `08-${parts.join(" ")}`;
  }
  return e164;
}
