import { ReportError } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createReportRoute, reportInput, type ReportRouteDeps } from "./report-route";
import type { StaffSession } from "./staff-auth";

const VISIT = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const LINE = "7f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const session: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step: "none",
  accessToken: "token",
};
const actor = { tenantId: "t1", userId: "u1", role: "mechanic" };

function deps(over: Partial<ReportRouteDeps> = {}): ReportRouteDeps {
  return {
    session: () => Promise.resolve(session),
    save: vi.fn(() => Promise.resolve()),
    approve: vi.fn(() => Promise.resolve()),
    addLine: vi.fn(() => Promise.resolve("l1")),
    removeLine: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const post = (fields: Record<string, string>) =>
  new Request(`http://127.0.0.1:3100/api/idag/${VISIT}/rapport`, {
    method: "POST",
    body: form(fields),
  });

const REPORT = {
  workDone: "Bytt impeller\nBytt olja",
  "rec-text-0": "Byt bälgen",
  "rec-priority-0": "next_season",
  "rec-text-1": "  ",
  "rec-priority-1": "now",
  nextService: "Vår",
};

describe("the report page's forms", () => {
  it("read the text and the filled-in recommendation rows only", () => {
    expect(reportInput(form(REPORT))).toEqual({
      workDone: "Bytt impeller\nBytt olja",
      recommendations: [{ text: "Byt bälgen", priority: "next_season" }],
      nextService: "Vår",
    });
  });

  it("save, and approve, going back to the report with what was done", async () => {
    const d = deps();
    const saved = await createReportRoute(d)(post({ do: "spara", ...REPORT }), VISIT);
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(`/idag/rapport/${VISIT}?klart=sparat`);
    // A form sent by the browser has its line breaks as CR LF, which the points read alike.
    expect(d.save).toHaveBeenCalledWith(actor, VISIT, {
      ...reportInput(form(REPORT)),
      workDone: expect.stringMatching(/^Bytt impeller\r?\nBytt olja$/) as unknown,
    });

    const approved = await createReportRoute(d)(post({ do: "godkann", ...REPORT }), VISIT);
    expect(approved.headers.get("location")).toBe(`/idag/rapport/${VISIT}?klart=godkand`);
    expect(d.approve).toHaveBeenCalledTimes(1);
  });

  it("add a line in kronor the Swedish way, and remove one", async () => {
    const d = deps();
    await createReportRoute(d)(
      post({
        do: "rad",
        lineType: "labour",
        description: "Extra timmar",
        quantity: "1,5",
        unitPrice: "1 150",
      }),
      VISIT,
    );
    expect(d.addLine).toHaveBeenCalledWith(actor, VISIT, {
      type: "labour",
      description: "Extra timmar",
      quantity: 1.5,
      unitPriceOre: 115_000,
    });
    const bad = await createReportRoute(d)(
      post({ do: "rad", lineType: "labour", description: "x", unitPrice: "mycket" }),
      VISIT,
    );
    expect(bad.headers.get("location")).toContain("fel=invalid_input");
    // Nothing written yet: the text is not saved, so a draft still coming is not stopped.
    expect(d.save).not.toHaveBeenCalled();

    const removed = await createReportRoute(d)(post({ do: `bort:${LINE}` }), VISIT);
    expect(removed.headers.get("location")).toBe(`/idag/rapport/${VISIT}?klart=bort`);
    expect(d.removeLine).toHaveBeenCalledWith(actor, VISIT, LINE);
    const notALine = await createReportRoute(d)(post({ do: "bort:x" }), VISIT);
    expect(notALine.headers.get("location")).toContain("fel=invalid_input");
  });

  it("keep the text written so far when a line is added or removed", async () => {
    const d = deps();
    await createReportRoute(d)(post({ do: `bort:${LINE}`, ...REPORT }), VISIT);
    expect(d.save).toHaveBeenCalledTimes(1);
    expect(d.removeLine).toHaveBeenCalledTimes(1);
    await createReportRoute(d)(
      post({
        do: "rad",
        lineType: "discount",
        description: "Rabatt",
        unitPrice: "-200",
        ...REPORT,
      }),
      VISIT,
    );
    expect(d.save).toHaveBeenCalledTimes(2);
    expect(d.addLine).toHaveBeenCalledWith(
      actor,
      VISIT,
      expect.objectContaining({ unitPriceOre: -20_000 }),
    );
  });

  it("say why it was refused: approved, empty, or not theirs", async () => {
    for (const code of ["approved", "empty", "forbidden"] as const) {
      const route = createReportRoute(
        deps({ approve: () => Promise.reject(new ReportError(code)) }),
      );
      const response = await route(post({ do: "godkann", ...REPORT }), VISIT);
      expect(response.headers.get("location")).toBe(`/idag/rapport/${VISIT}?fel=${code}`);
    }
  });

  it("refuse someone signed out, a visit id that is not one, and an unknown action", async () => {
    const signedOut = createReportRoute(deps({ session: () => Promise.resolve(null) }));
    expect((await signedOut(post({ do: "spara" }), VISIT)).status).toBe(401);
    const d = deps();
    expect((await createReportRoute(d)(post({ do: "spara" }), "x")).status).toBe(404);
    const unknown = await createReportRoute(d)(post({ do: "radera-allt" }), VISIT);
    expect(unknown.headers.get("location")).toContain("fel=invalid_input");
    expect(d.save).not.toHaveBeenCalled();
  });
});
