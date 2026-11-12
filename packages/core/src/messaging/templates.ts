import type { messages } from "../i18n/sv";

/**
 * The message templates of spec part 1, chapter 7, typed (byggplan step 3.1). The texts
 * live in `i18n/sv.ts`; this file says what each one is for.
 */
type Texts = typeof messages;
export type SmsTemplateKey = keyof Texts["sms"];
export type PushTemplateKey = keyof Texts["push"];
export type EmailTemplateKey = keyof Texts["email"];

/** The `{name}` placeholders of a text, as a union of names. */
export type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

export type SmsVars<K extends SmsTemplateKey> = Record<Placeholders<Texts["sms"][K]>, string>;
export type PushVars<K extends PushTemplateKey> = Record<Placeholders<Texts["push"][K]>, string>;
export type EmailVars<K extends EmailTemplateKey> = Record<
  Placeholders<Texts["email"][K]["subject"]> | Placeholders<Texts["email"][K]["body"]>,
  string
>;

/**
 * What decides whether a message waits or is stopped (`delivery.ts`):
 * - `code`: a one-time code the person just asked for. Always sent at once, also after STOPP.
 * - `reply`: an answer to something the customer just did. Sent at once, stopped by STOPP.
 * - `notice`: about a booking. Waits for 08:00 during quiet hours, stopped by STOPP.
 * - `marketing`: campaigns and offers. Like `notice`, and needs consent (checked by the flow).
 */
export type MessageCategory = "code" | "reply" | "notice" | "marketing";

export type Flow =
  | "auth"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "F7"
  | "F8"
  | "F9"
  | "F10"
  | "F11"
  | "F12"
  | "F13"
  | "F14"
  | "F15";

export interface SmsTemplateInfo {
  flow: Flow;
  category: MessageCategory;
  /** The spec's segment count for the text, which it must stay within with real data. */
  maxSegments: number;
}

export const SMS_TEMPLATES = {
  staff_sign_in_code: { flow: "auth", category: "code", maxSegments: 1 },
  booking_code: { flow: "auth", category: "code", maxSegments: 1 },
  f1_confirmation: { flow: "F1", category: "notice", maxSegments: 3 },
  f2_tentative: { flow: "F2", category: "notice", maxSegments: 2 },
  f2_parts_arrived: { flow: "F2", category: "notice", maxSegments: 2 },
  f3_check_water: { flow: "F3", category: "notice", maxSegments: 3 },
  f3_check_water_code: { flow: "F3", category: "notice", maxSegments: 3 },
  f3_check_land: { flow: "F3", category: "notice", maxSegments: 3 },
  f3_check_land_code: { flow: "F3", category: "notice", maxSegments: 3 },
  f3_reply_yes: { flow: "F3", category: "reply", maxSegments: 2 },
  f3_reply_no: { flow: "F3", category: "reply", maxSegments: 2 },
  f3_reply_change: { flow: "F3", category: "reply", maxSegments: 2 },
  f3_reminder: { flow: "F3", category: "notice", maxSegments: 2 },
  f4_offer: { flow: "F4", category: "notice", maxSegments: 3 },
  f4_taken: { flow: "F4", category: "reply", maxSegments: 2 },
  f5_eta: { flow: "F5", category: "notice", maxSegments: 2 },
  f6_on_way: { flow: "F6", category: "notice", maxSegments: 2 },
  f7_report: { flow: "F7", category: "notice", maxSegments: 2 },
  f8_payment_reminder: { flow: "F8", category: "notice", maxSegments: 2 },
  f9_survey: { flow: "F9", category: "notice", maxSegments: 2 },
  f9_reply_good: { flow: "F9", category: "reply", maxSegments: 3 },
  f9_reply_poor: { flow: "F9", category: "reply", maxSegments: 2 },
  f10_next_season: { flow: "F10", category: "marketing", maxSegments: 3 },
  f11_spring_a: { flow: "F11", category: "marketing", maxSegments: 3 },
  f11_spring_discount: { flow: "F11", category: "marketing", maxSegments: 3 },
  f11_spring_b: { flow: "F11", category: "marketing", maxSegments: 3 },
  f11_sold_question: { flow: "F11", category: "reply", maxSegments: 1 },
  f12_autumn: { flow: "F12", category: "marketing", maxSegments: 3 },
  f12_haulout_question: { flow: "F12", category: "reply", maxSegments: 2 },
  f13_service_reminder: { flow: "F13", category: "marketing", maxSegments: 3 },
  f14_received: { flow: "F14", category: "reply", maxSegments: 3 },
  f14_taken: { flow: "F14", category: "reply", maxSegments: 3 },
  f14_none_available: { flow: "F14", category: "reply", maxSegments: 3 },
  f14_moved: { flow: "F14", category: "notice", maxSegments: 3 },
  f15_type_plate: { flow: "F15", category: "reply", maxSegments: 3 },
} as const satisfies Record<SmsTemplateKey, SmsTemplateInfo>;

export const EMAIL_TEMPLATES = {
  f1_confirmation: { flow: "F1", category: "notice" },
  f7_report: { flow: "F7", category: "notice" },
  f11_spring: { flow: "F11", category: "marketing" },
} as const satisfies Record<EmailTemplateKey, { flow: Flow; category: MessageCategory }>;

export const PUSH_TEMPLATES = {
  f3_unconfirmed: { flow: "F3" },
  f14_emergency: { flow: "F14" },
} as const satisfies Record<PushTemplateKey, { flow: Flow }>;
