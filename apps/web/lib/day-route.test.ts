import { BookingError, DayError } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createDayRoute, dayProblem, type DayRouteDeps } from "./day-route";
import type { StaffSession } from "./staff-auth";

const VISIT = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const ENGINE = "7f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const KEY = "8f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const session: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step: "none",
  accessToken: "token",
};

function deps(over: Partial<DayRouteDeps> = {}): DayRouteDeps {
  const ok = () => Promise.resolve();
  return {
    session: () => Promise.resolve(session),
    visitDay: () => Promise.resolve("2027-04-20"),
    start: vi.fn(ok),
    complete: vi.fn(ok),
    hours: vi.fn(ok),
    addPart: vi.fn(ok),
    partStatus: vi.fn(ok),
    photo: vi.fn(ok),
    note: vi.fn(ok),
    ...over,
  };
}

const post = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(`http://127.0.0.1:3100/api/idag/${VISIT}/x`, { method: "POST", body: form });
};

describe("the day view's forms", () => {
  it("starts a visit and goes back to the visit on its day", async () => {
    const d = deps();
    const response = await createDayRoute(d)(post({ key: KEY }), VISIT, "starta");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/idag?dag=2027-04-20&klart=starta#besok-${VISIT}`,
    );
    expect(d.start).toHaveBeenCalledWith(
      { tenantId: "t1", userId: "u1", role: "mechanic" },
      VISIT,
      KEY,
    );
  });

  it("reads hours written the Swedish way", async () => {
    const d = deps();
    await createDayRoute(d)(
      post({ key: KEY, engineId: ENGINE, hours: "1 342,5" }),
      VISIT,
      "timmar",
    );
    expect(d.hours).toHaveBeenCalledWith(expect.anything(), VISIT, KEY, ENGINE, 1342.5);
  });

  it("says what was wrong, on the page", async () => {
    const refuse = (error: Error) =>
      createDayRoute(deps({ hours: () => Promise.reject(error) }))(
        post({ key: KEY, engineId: ENGINE, hours: "10" }),
        VISIT,
        "timmar",
      );
    expect((await refuse(new DayError("hours_below_last"))).headers.get("location")).toContain(
      "fel=hours_below_last",
    );
    // A missing key is refused before anything happens.
    const d = deps();
    const r = await createDayRoute(d)(post({}), VISIT, "starta");
    expect(r.headers.get("location")).toContain("fel=invalid_input");
    expect(d.start).not.toHaveBeenCalled();
  });

  it("refuses someone signed out, a visit id that is not one and an unknown action", async () => {
    const out = createDayRoute(deps({ session: () => Promise.resolve(null) }));
    expect((await out(post({ key: KEY }), VISIT, "starta")).status).toBe(401);
    const route = createDayRoute(deps());
    expect((await route(post({ key: KEY }), "x", "starta")).status).toBe(404);
    expect((await route(post({ key: KEY }), VISIT, "radera")).status).toBe(404);
  });

  it("needs a key on every form, so a form sent twice is done once", async () => {
    const d = deps();
    const r = await createDayRoute(d)(post({ engineId: ENGINE, hours: "10" }), VISIT, "timmar");
    expect(r.headers.get("location")).toContain("fel=invalid_input");
    expect(d.hours).not.toHaveBeenCalled();
  });

  it("saves a note", async () => {
    const d = deps();
    await createDayRoute(d)(post({ key: KEY, note: " Bälgen sprucken. " }), VISIT, "anteckning");
    expect(d.note).toHaveBeenCalledWith(expect.anything(), VISIT, KEY, "Bälgen sprucken.");
  });

  it("answers the offline queue with JSON: done, refused for good, or try again", async () => {
    const json = (fields: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      return new Request(`http://127.0.0.1:3100/api/idag/${VISIT}/x`, {
        method: "POST",
        headers: { accept: "application/json" },
        body: form,
      });
    };
    const done = await createDayRoute(deps())(json({ key: KEY }), VISIT, "klart");
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, done: "klart" });

    const refused = await createDayRoute(
      deps({ complete: () => Promise.reject(new BookingError("invalid_transition")) }),
    )(json({ key: KEY }), VISIT, "klart");
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ ok: false, problem: "wrong_state" });

    const broken = await createDayRoute(
      deps({ complete: () => Promise.reject(new Error("database down")) }),
    )(json({ key: KEY }), VISIT, "klart");
    expect(broken.status).toBe(500);

    const signedOut = await createDayRoute(deps({ session: () => Promise.resolve(null) }))(
      json({ key: KEY }),
      VISIT,
      "klart",
    );
    expect(signedOut.status).toBe(401);
  });

  it("turns refusals into the page's words", () => {
    expect(dayProblem(new DayError("forbidden"))).toBe("forbidden");
    expect(dayProblem(new BookingError("invalid_transition"))).toBe("wrong_state");
    expect(dayProblem(new BookingError("not_found"))).toBe("not_found");
    expect(dayProblem(new Error("boom"))).toBe("failed");
  });
});
