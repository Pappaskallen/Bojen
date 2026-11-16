import { NameplateError } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createNameplateRoute, type NameplateRouteDeps } from "./nameplate-route";
import type { StaffSession } from "./staff-auth";

const BOAT = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const READING = "7f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const ENGINE = "8f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const session: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step: "none",
  accessToken: "token",
};

function route(over: Partial<NameplateRouteDeps> = {}) {
  const deps: NameplateRouteDeps = {
    session: () => Promise.resolve(session),
    decide: vi.fn(() => Promise.resolve({ engineId: ENGINE })),
    ...over,
  };
  return { deps, decide: createNameplateRoute(deps) };
}
const post = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(`http://localhost/api/batar/${BOAT}/typskylt/${READING}`, {
    method: "POST",
    body: form,
  });
};

describe("a type plate suggestion", () => {
  it("is confirmed onto the chosen engine, or dismissed, back on the boat card", async () => {
    const { deps, decide } = route();
    const confirmed = await decide(post({ do: "confirm", engineId: ENGINE }), BOAT, READING);
    expect(confirmed.headers.get("location")).toBe(`/batar/${BOAT}?typskylt=confirmed#motorer`);
    expect(deps.decide).toHaveBeenCalledWith(
      { tenantId: "t1", userId: "u1", role: "mechanic" },
      READING,
      "confirm",
      ENGINE,
    );
    await decide(post({ do: "confirm", engineId: "ny" }), BOAT, READING);
    expect(deps.decide).toHaveBeenLastCalledWith(expect.anything(), READING, "confirm", "new");
    const dismissed = await decide(post({ do: "dismiss", engineId: "" }), BOAT, READING);
    expect(dismissed.headers.get("location")).toBe(`/batar/${BOAT}?typskylt=dismissed#motorer`);
    expect(deps.decide).toHaveBeenLastCalledWith(expect.anything(), READING, "dismiss", undefined);
  });

  it("says why when it cannot, and is refused to someone signed out", async () => {
    const decided = route({ decide: () => Promise.reject(new NameplateError("decided")) });
    expect(
      (await decided.decide(post({ do: "confirm" }), BOAT, READING)).headers.get("location"),
    ).toBe(`/batar/${BOAT}?typskyltfel=decided#motorer`);
    const { deps, decide } = route();
    expect((await decide(post({ do: "radera" }), BOAT, READING)).headers.get("location")).toContain(
      "typskyltfel=failed",
    );
    expect((await decide(post({ do: "confirm" }), BOAT, "x")).status).toBe(404);
    expect(deps.decide).not.toHaveBeenCalled();
    const out = route({ session: () => Promise.resolve(null) });
    expect((await out.decide(post({ do: "confirm" }), BOAT, READING)).status).toBe(401);
  });
});
