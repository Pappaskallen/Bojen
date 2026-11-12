import { messages } from "../i18n/sv";
import { countSegments, toSmsCharacters, type SegmentCount } from "./segments";
import {
  SMS_TEMPLATES,
  type EmailTemplateKey,
  type EmailVars,
  type MessageCategory,
  type PushTemplateKey,
  type PushVars,
  type SmsTemplateKey,
  type SmsVars,
} from "./templates";

export class MissingVariableError extends Error {
  constructor(
    readonly template: string,
    readonly variable: string,
  ) {
    super(`Template ${template} needs {${variable}}`);
    this.name = "MissingVariableError";
  }
}

/** Fills in `{name}`; a missing or empty value is an error, never a silent gap. */
function fill(template: string, text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined || value.trim() === "") throw new MissingVariableError(template, name);
    return value;
  });
}

export interface RenderedSms extends SegmentCount {
  template: SmsTemplateKey;
  category: MessageCategory;
  body: string;
}

/** The sms text, with typographic characters swapped for GSM-7 ones, and what it costs. */
export function renderSms<K extends SmsTemplateKey>(key: K, vars: SmsVars<K>): RenderedSms {
  const body = toSmsCharacters(fill(key, messages.sms[key], vars));
  return { template: key, category: SMS_TEMPLATES[key].category, body, ...countSegments(body) };
}

export function renderPush<K extends PushTemplateKey>(key: K, vars: PushVars<K>): string {
  return fill(key, messages.push[key], vars);
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * The e-mail as plain text and simple HTML. `**bold**` in the template becomes `<strong>`;
 * values are escaped, so a customer's name can never inject markup.
 */
export function renderEmail<K extends EmailTemplateKey>(key: K, vars: EmailVars<K>): RenderedEmail {
  const template = messages.email[key];
  const values = vars as Record<string, string>;
  const subject = fill(key, template.subject, values);
  const text = fill(key, template.body, values).replace(/\*\*/g, "");
  const escaped: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) escaped[name] = escapeHtml(value);
  const html = fill(key, escapeHtml(template.body), escaped)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return { subject, text, html };
}
