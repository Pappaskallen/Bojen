/**
 * The customer export as a document a person can read (spec 10.3: "Export (JSON och pdf)").
 * This decides what the document says and in which order; the web app draws it as a pdf.
 * Like the JSON export it never holds a code or the access information itself, only that
 * there is some, and a recording only as "there is one".
 *
 * Times are stored in UTC and shown in Stockholm (CLAUDE.md).
 */
import { formatPhone } from "../contact/phone";
import { crm } from "../i18n/sv";
import { DISPLAY_TIME_ZONE, stockholmDate } from "../time";

type When = Date | string;

/** The shape of `exportCustomer` in `@bojen/db`, as far as the document needs it. */
export interface CustomerExportData {
  exportedAt: string;
  firm: { name: string };
  customer: {
    name: string;
    type: string;
    phone: string | null;
    email: string | null;
    billingAddress: string | null;
    language: string;
    acquisitionChannel: string | null;
    createdAt: When;
  };
  consents: { type: string; status: string; recordedAt: When; source: string | null }[];
  boats: {
    name: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    lengthM: string | null;
    registrationNumber: string | null;
    role: string | null;
    engines: {
      make: string | null;
      model: string | null;
      modelYear: number | null;
      serialNumber: string | null;
      hours: { hours: string; readAt: When }[];
    }[];
    placements: {
      season: string;
      mode: string;
      spotId: string | null;
      launchDate: string | null;
      haulOutDate: string | null;
    }[];
    hasAccessInformation: boolean;
  }[];
  jobs: {
    status: string;
    description: string | null;
    createdAt: When;
    visits: {
      timeWindow: string;
      status: string;
      notes: string | null;
      report: {
        workDone: string | null;
        recommendations: { text: string; priority: string }[];
        nextService: string | null;
        approvedAt: When | null;
      } | null;
      survey: { score: number | null; comment: string | null; answeredAt: When | null } | null;
    }[];
  }[];
  messages: {
    at: When;
    channel: string;
    direction: string;
    subject: string | null;
    body: string | null;
    status: string;
  }[];
  calls: {
    startedAt: When;
    callerNumber: string | null;
    transcript: string | null;
    summary: string | null;
    hasRecording: boolean;
  }[];
}

export type DocumentLine =
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "field"; label: string; value: string }
  | { kind: "text"; text: string };

export interface ExportDocument {
  title: string;
  subtitle: string;
  intro: string;
  lines: DocumentLine[];
}

const t = crm.privacy.pdf;

const asDate = (when: When): Date => (when instanceof Date ? when : new Date(when));

const clock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: DISPLAY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/** `2026-05-01 08:00` in Stockholm. */
export function stockholmDateTime(when: When): string {
  const d = asDate(when);
  return `${stockholmDate(d)} ${clock.format(d)}`;
}

/** A Postgres `tstzrange` as written by the driver, e.g. `["2026-05-01 06:00:00+00",…)`. */
export function formatTimeWindow(range: string): string {
  const match = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(range.trim());
  const instant = (value: string | undefined) => {
    if (!value) return null;
    const iso = value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const start = instant(match?.[1]);
  const end = instant(match?.[2]);
  if (!start || !end) return range;
  const sameDay = stockholmDate(start) === stockholmDate(end);
  return `${stockholmDateTime(start)}–${sameDay ? clock.format(end) : stockholmDateTime(end)}`;
}

const label = (labels: Record<string, string>, key: string | null) =>
  key === null ? t.none : (labels[key] ?? key);
const joined = (...parts: (string | number | null)[]) =>
  parts.filter((p) => p !== null && p !== "").join(" ") || t.none;

export function exportDocument(data: CustomerExportData): ExportDocument {
  const c = data.customer;
  const lines: DocumentLine[] = [];
  const heading = (text: string) => lines.push({ kind: "heading", text });
  const sub = (text: string) => lines.push({ kind: "subheading", text });
  const text = (value: string) => lines.push({ kind: "text", text: value });
  const field = (name: string, value: string | null) =>
    lines.push({ kind: "field", label: name, value: value && value.length > 0 ? value : t.none });

  heading(t.customer);
  field(t.name, c.name);
  field(t.type, label(crm.customerType, c.type));
  field(t.phone, c.phone ? formatPhone(c.phone) : null);
  field(t.email, c.email);
  field(t.billingAddress, c.billingAddress);
  field(t.language, label(crm.language, c.language));
  field(t.channel, c.acquisitionChannel ? label(t.channels, c.acquisitionChannel) : null);
  field(t.createdAt, stockholmDate(asDate(c.createdAt)));

  heading(t.consents);
  if (data.consents.length === 0) text(t.noConsents);
  for (const consent of data.consents) {
    text(
      t.consentLine(
        label(t.consentType, consent.type),
        label(t.consentStatus, consent.status),
        stockholmDate(asDate(consent.recordedAt)),
        consent.source ?? t.none,
      ),
    );
  }

  heading(t.boats);
  if (data.boats.length === 0) text(t.noBoats);
  for (const b of data.boats) {
    sub(b.name ?? joined(b.make, b.model));
    field(t.role, label(crm.ownershipRole, b.role));
    field(t.model, joined(b.make, b.model));
    field(t.year, b.year === null ? null : String(b.year));
    field(t.length, b.lengthM === null ? null : `${b.lengthM.replace(".", ",")} m`);
    field(t.registration, b.registrationNumber);
    for (const e of b.engines) {
      field(t.engine, joined(e.make, e.model, e.modelYear));
      if (e.serialNumber) field(t.serial, e.serialNumber);
      for (const h of e.hours) {
        field(t.hours, t.hoursLine(h.hours.replace(".", ","), stockholmDate(asDate(h.readAt))));
      }
    }
    for (const p of b.placements) {
      const dates = [p.launchDate, p.haulOutDate].some(Boolean)
        ? `${p.launchDate ?? "?"}–${p.haulOutDate ?? "?"}`
        : "";
      field(
        t.placement,
        t.placementLine(
          label(crm.season, p.season),
          label(crm.placementMode, p.mode),
          p.spotId,
          dates,
        ),
      );
    }
    if (b.hasAccessInformation) field(t.access, t.accessStored);
  }

  heading(t.jobs);
  if (data.jobs.length === 0) text(t.noJobs);
  for (const j of data.jobs) {
    sub(`${t.job} ${stockholmDate(asDate(j.createdAt))}`);
    field(t.status, label(crm.pipeline.columns, j.status));
    if (j.description) field(t.description, j.description);
    for (const v of j.visits) {
      field(
        t.visit,
        `${formatTimeWindow(v.timeWindow)} (${label(crm.visitStatus, v.status).toLowerCase()})`,
      );
      if (v.notes) field(t.notes, v.notes);
      const r = v.report;
      if (r) {
        if (r.workDone) field(t.workDone, r.workDone);
        for (const rec of r.recommendations) {
          field(t.recommendations, `${label(crm.report.priority, rec.priority)}: ${rec.text}`);
        }
        if (r.nextService) field(t.nextService, r.nextService);
      }
      if (v.survey?.score != null) field(t.survey, t.surveyLine(v.survey.score, v.survey.comment));
    }
  }

  heading(t.messages);
  if (data.messages.length === 0) text(t.noMessages);
  for (const m of [...data.messages].sort((a, b) => +asDate(a.at) - +asDate(b.at))) {
    sub(
      t.messageLine(
        stockholmDateTime(m.at),
        label(crm.message.channel, m.channel),
        label(crm.message.direction, m.direction),
        label(crm.message.status, m.status),
      ),
    );
    if (m.subject) text(m.subject);
    text(m.body ?? t.cleared);
  }

  heading(t.calls);
  if (data.calls.length === 0) text(t.noCalls);
  for (const call of [...data.calls].sort((a, b) => +asDate(a.startedAt) - +asDate(b.startedAt))) {
    sub(
      t.callLine(
        stockholmDateTime(call.startedAt),
        call.callerNumber ? formatPhone(call.callerNumber) : null,
      ),
    );
    if (call.summary) field(t.summary, call.summary);
    if (call.transcript) field(t.transcript, call.transcript);
    if (call.hasRecording) field(t.recording, t.recordingStored);
    if (!call.summary && !call.transcript && !call.hasRecording) text(t.cleared);
  }

  return {
    title: t.title(c.name),
    subtitle: t.from(data.firm.name, stockholmDate(new Date(data.exportedAt))),
    intro: t.intro,
    lines,
  };
}
