import { crm } from "@bojen/core/i18n/sv";

const dateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "short",
});
const date = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "medium",
});

/** "2026-11-16 14:00", in Stockholm time. */
export const showDateTime = (d: Date) => dateTime.format(d);

/** "16 nov. 2026". */
export const showDate = (d: Date) => date.format(d);

/** The boat as staff call it: its name, or make and model, or a dash. */
export function boatLabel(b: { name: string | null; make: string | null; model: string | null }) {
  const makeModel = [b.make, b.model].filter(Boolean).join(" ");
  if (b.name && makeModel) return `${b.name} (${makeModel})`;
  return b.name ?? (makeModel || crm.card.unknown);
}

/** A word from a table of texts, or the word itself when the table does not have it. */
export const word = (table: Record<string, string>, key: string | null | undefined) =>
  key ? (table[key] ?? key) : crm.card.unknown;
