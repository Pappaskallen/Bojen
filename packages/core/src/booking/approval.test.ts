import { describe, expect, it } from "vitest";
import { matchingRule, needsApproval, type ApprovalRule, type CustomerKind } from "./approval";

const LAY_UP = "lay-up";
const SPRING = "spring";

describe("needsApproval", () => {
  it("approves new customers by hand and books existing ones without rules (W5)", () => {
    expect(needsApproval({ rules: [], serviceTypeId: LAY_UP, customerKind: "new" })).toBe(true);
    expect(needsApproval({ rules: [], serviceTypeId: LAY_UP, customerKind: "existing" })).toBe(
      false,
    );
  });

  const rules: ApprovalRule[] = [
    { serviceTypeId: null, customerKind: null, mode: "manual" },
    { serviceTypeId: null, customerKind: "existing", mode: "auto" },
    { serviceTypeId: LAY_UP, customerKind: null, mode: "auto" },
    { serviceTypeId: LAY_UP, customerKind: "existing", mode: "manual" },
  ];

  it.each<[string, CustomerKind, boolean, string]>([
    [SPRING, "new", true, "everything: manual"],
    [SPRING, "existing", false, "existing customers: auto"],
    [LAY_UP, "new", false, "lay-up for everyone: auto"],
    [LAY_UP, "existing", true, "lay-up for existing customers: manual"],
  ])("%s for a %s customer → %s (%s)", (serviceTypeId, customerKind, expected) => {
    expect(needsApproval({ rules, serviceTypeId, customerKind })).toBe(expected);
  });

  it("picks the most specific rule whatever the order", () => {
    expect(
      matchingRule({
        rules: [...rules].reverse(),
        serviceTypeId: LAY_UP,
        customerKind: "existing",
      }),
    ).toEqual(rules[3]);
  });

  it("always approves emergencies by hand", () => {
    const allAuto: ApprovalRule[] = [{ serviceTypeId: null, customerKind: null, mode: "auto" }];
    expect(
      needsApproval({
        rules: allAuto,
        serviceTypeId: LAY_UP,
        customerKind: "existing",
        urgency: "emergency",
      }),
    ).toBe(true);
    expect(needsApproval({ rules: allAuto, serviceTypeId: LAY_UP, customerKind: "new" })).toBe(
      false,
    );
  });
});
