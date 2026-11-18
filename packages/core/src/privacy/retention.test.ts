import { describe, expect, it } from "vitest";
import { audioDays, monthsBefore, retentionCutoffs } from "./retention";

describe("retention", () => {
  const NOW = new Date("2027-03-31T02:00:00Z");

  it("counts calendar months, also from the end of a month", () => {
    expect(monthsBefore(NOW, 1).toISOString()).toBe("2027-02-28T02:00:00.000Z");
    expect(monthsBefore(NOW, 24).toISOString()).toBe("2025-03-31T02:00:00.000Z");
    expect(monthsBefore(new Date("2028-03-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("keeps audio 90 days unless the firm chose 30", () => {
    expect(audioDays({})).toBe(90);
    expect(audioDays({ privacy: { audioDays: 30 } })).toBe(30);
    expect(audioDays({ privacy: { audioDays: 7 } })).toBe(90);
    expect(audioDays(null)).toBe(90);
  });

  it("gives every cut-off of spec 10.3", () => {
    const c = retentionCutoffs(NOW, { privacy: { audioDays: 30 } });
    expect(c.audioBefore.toISOString()).toBe("2027-03-01T02:00:00.000Z");
    expect(c.callTextBefore.toISOString()).toBe("2025-03-31T02:00:00.000Z");
    expect(c.inquiryBefore.toISOString()).toBe("2026-03-31T02:00:00.000Z");
    expect(c.customerBefore.toISOString()).toBe("2024-03-31T02:00:00.000Z");
    expect(c.messageBefore.toISOString()).toBe("2025-03-31T02:00:00.000Z");
    expect(c.auditBefore.toISOString()).toBe("2025-03-31T02:00:00.000Z");
    expect(c.accessBefore).toBe("2027-03-31");
  });
});
