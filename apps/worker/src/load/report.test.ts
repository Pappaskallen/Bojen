import { describe, expect, it } from "vitest";
import { loadReport } from "./report";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 22, 10, 0, 0) + seconds * 1000);

describe("loadReport", () => {
  it("passes when everything was sent fast enough", () => {
    // 600 queued at 0 s, sent evenly over 60 s: 600 per minute.
    const samples = Array.from({ length: 600 }, (_, i) => ({
      queuedAt: at(0),
      sentAt: at(((i + 1) / 600) * 60),
    }));
    expect(loadReport(samples, { perMinute: 500 })).toEqual({
      total: 600,
      sent: 600,
      seconds: 60,
      perMinute: 600,
      waitP50: 30,
      waitP95: 57,
      waitMax: 60,
      passed: true,
    });
  });

  it("fails when it is too slow or a message was never sent", () => {
    const slow = Array.from({ length: 100 }, (_, i) => ({ queuedAt: at(0), sentAt: at(i + 1) }));
    expect(loadReport(slow, { perMinute: 500 })).toMatchObject({ perMinute: 60, passed: false });
    const lost = [
      { queuedAt: at(0), sentAt: at(1) },
      { queuedAt: at(0), sentAt: null },
    ];
    expect(loadReport(lost, { perMinute: 1 })).toMatchObject({ sent: 1, passed: false });
    expect(loadReport([], { perMinute: 1 }).passed).toBe(false);
  });
});
