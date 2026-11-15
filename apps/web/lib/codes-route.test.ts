import { AccessDeniedError } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createCodesRoute, type CodesRouteDeps } from "./codes-route";
import type { StaffSession } from "./staff-auth";

const VISIT = "00000000-0000-4000-8000-000000000001";
const session: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step: "none",
  accessToken: "token",
};
const codes = {
  code: "1234#",
  keyLocation: "Under dynan",
  gateCode: null,
  keyBox: null,
  deleteBy: new Date("2027-04-20T20:00:00Z"),
};

function route(over: Partial<CodesRouteDeps> = {}) {
  const deps: CodesRouteDeps = {
    session: () => Promise.resolve(session),
    codes: vi.fn(() => Promise.resolve(codes)),
    ...over,
  };
  return { deps, codes: createCodesRoute(deps) };
}
const request = () => new Request(`http://localhost/api/idag/${VISIT}/koder`, { method: "POST" });

describe("the codes for the phone", () => {
  it("are given to the signed-in mechanic, and never cached", async () => {
    const { deps, codes: handle } = route();
    const response = await handle(request(), VISIT);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ...codes, deleteBy: "2027-04-20T20:00:00.000Z" });
    expect(deps.codes).toHaveBeenCalledWith("u1", VISIT);
  });

  it("need a whole sign-in: none, or one waiting for the second factor, gets nothing", async () => {
    for (const s of [null, { ...session, step: "challenge" as const }]) {
      const { deps, codes: handle } = route({ session: () => Promise.resolve(s) });
      const response = await handle(request(), VISIT);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(deps.codes).not.toHaveBeenCalled();
    }
  });

  it("are refused with the reason when the access rule says no, without codes", async () => {
    const { codes: handle } = route({
      codes: () => Promise.reject(new AccessDeniedError("outside_window")),
    });
    const response = await handle(request(), VISIT);
    expect(response.status).toBe(403);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("outside_window");
    expect(body).not.toContain("1234#");
  });

  it("are not looked up for an id that is not a visit id", async () => {
    const { deps, codes: handle } = route();
    expect((await handle(request(), "inte-ett-id")).status).toBe(404);
    expect(deps.codes).not.toHaveBeenCalled();
  });
});
