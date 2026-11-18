/**
 * How long Bojen keeps what (spec 10.3, byggplan step 7.4). The nightly clean-up in the
 * worker asks for the cut-off dates here and removes what is older; nothing else decides.
 *
 * | What                                  | Kept                                     |
 * | ------------------------------------- | ---------------------------------------- |
 * | Call audio                            | 90 days, or 30 if the firm chose it      |
 * | Call transcript and summary           | 24 months                                |
 * | Inquiries that did not become work    | 12 months                                |
 * | Customer, boat and history            | 36 months after the last job; then the   |
 * |                                       | customer is anonymised, the boat's       |
 * |                                       | technical history stays                  |
 * | Access information                    | until its end date                       |
 * | Message content                       | 24 months; the metadata stays            |
 * | Audit log                             | 24 months                                |
 * | Opt-outs (STOPP)                      | for good, as a hash                      |
 */

export const RETENTION = {
  audioDays: 90,
  callTextMonths: 24,
  inquiryMonths: 12,
  customerMonthsAfterLastJob: 36,
  messageMonths: 24,
  auditMonths: 24,
} as const;

/** The audio choices a firm has (spec 10.5): 30 or 90 days. */
export const AUDIO_DAY_CHOICES = [30, 90] as const;

/** The firm's audio retention from `tenant.settings.privacy.audioDays`; 90 unless it chose 30. */
export function audioDays(settings: unknown): number {
  const value = (settings as { privacy?: { audioDays?: unknown } } | null)?.privacy?.audioDays;
  return AUDIO_DAY_CHOICES.includes(value as 30 | 90) ? (value as number) : RETENTION.audioDays;
}

/** `months` calendar months before `date`, at the same time of day (31 March − 1 → 28/29 Feb). */
export function monthsBefore(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export interface RetentionCutoffs {
  /** Call audio from before this is deleted. */
  audioBefore: Date;
  callTextBefore: Date;
  inquiryBefore: Date;
  /** A customer whose last job ended before this is anonymised. */
  customerBefore: Date;
  messageBefore: Date;
  auditBefore: Date;
  /** Access information valid until a day before this (YYYY-MM-DD) is deleted. */
  accessBefore: string;
}

export function retentionCutoffs(now: Date, settings: unknown): RetentionCutoffs {
  return {
    audioBefore: new Date(now.getTime() - audioDays(settings) * 86_400_000),
    callTextBefore: monthsBefore(now, RETENTION.callTextMonths),
    inquiryBefore: monthsBefore(now, RETENTION.inquiryMonths),
    customerBefore: monthsBefore(now, RETENTION.customerMonthsAfterLastJob),
    messageBefore: monthsBefore(now, RETENTION.messageMonths),
    auditBefore: monthsBefore(now, RETENTION.auditMonths),
    accessBefore: now.toISOString().slice(0, 10),
  };
}
