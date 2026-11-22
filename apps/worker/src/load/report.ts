/**
 * The result of the sms load test (byggplan, Avslutande kontroll: 500 sms per minute through
 * the queue). Pure, so the pass mark is tested on its own.
 */
export interface LoadSample {
  /** When the message was queued. */
  queuedAt: Date;
  /** When the worker marked it sent, or null if it never was. */
  sentAt: Date | null;
}

export interface LoadReport {
  total: number;
  sent: number;
  /** From the first queued message to the last one sent. */
  seconds: number;
  perMinute: number;
  /** Seconds from queued to sent. */
  waitP50: number;
  waitP95: number;
  waitMax: number;
  passed: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Passed when every message was sent at `perMinute` or faster. */
export function loadReport(samples: LoadSample[], target: { perMinute: number }): LoadReport {
  const sent = samples.filter((s): s is { queuedAt: Date; sentAt: Date } => s.sentAt !== null);
  const first = Math.min(...samples.map((s) => s.queuedAt.getTime()));
  const last = Math.max(...sent.map((s) => s.sentAt.getTime()));
  const seconds = sent.length ? Math.max(0.001, (last - first) / 1000) : 0;
  const waits = sent
    .map((s) => (s.sentAt.getTime() - s.queuedAt.getTime()) / 1000)
    .sort((a, b) => a - b);
  const perMinute = seconds ? (sent.length / seconds) * 60 : 0;
  return {
    total: samples.length,
    sent: sent.length,
    seconds: round(seconds),
    perMinute: Math.round(perMinute),
    waitP50: round(percentile(waits, 50)),
    waitP95: round(percentile(waits, 95)),
    waitMax: round(waits.at(-1) ?? 0),
    passed: samples.length > 0 && sent.length === samples.length && perMinute >= target.perMinute,
  };
}
