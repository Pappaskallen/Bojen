import { Secret } from "@bojen/core/crypto";
import { AccessDeniedError, type RevealedAccess } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createBoatAccessRoute } from "./boat-access";

const BOAT = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const staff = { tenantId: "t1", actor: { type: "staff" as const, id: "u1" } };
const shown: RevealedAccess = {
  code: new Secret("4711#"),
  keyLocation: new Secret("Under fendern"),
  gateCode: null,
  keyBox: null,
  contactName: "Hamnkaptenen",
  contactPhone: null,
};

const post = (body: unknown) =>
  new Request(`http://127.0.0.1:3100/api/batar/${BOAT}/atkomst`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("showing the code from the boat card", () => {
  it("answers with the codes after the confirmation, never cached", async () => {
    const reveal = vi.fn(() => Promise.resolve(shown));
    const route = createBoatAccessRoute({ authorize: () => Promise.resolve(staff), reveal });
    const response = await route(post({ confirm: true }), BOAT);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      code: "4711#",
      keyLocation: "Under fendern",
      gateCode: null,
      keyBox: null,
      contactName: "Hamnkaptenen",
      contactPhone: null,
    });
    expect(reveal).toHaveBeenCalledWith("u1", BOAT);
  });

  it("reads nothing without the confirmation", async () => {
    const reveal = vi.fn(() => Promise.resolve(shown));
    const route = createBoatAccessRoute({ authorize: () => Promise.resolve(staff), reveal });
    for (const body of [{}, { confirm: "true" }, { confirm: 1 }, null]) {
      const response = await route(post(body), BOAT);
      expect(response.status).toBe(400);
    }
    expect(reveal).not.toHaveBeenCalled();
  });

  it("refuses someone who is not signed in, and a boat id that is not one", async () => {
    const reveal = vi.fn(() => Promise.resolve(shown));
    const signedOut = createBoatAccessRoute({ authorize: () => Promise.resolve(null), reveal });
    expect((await signedOut(post({ confirm: true }), BOAT)).status).toBe(401);
    const route = createBoatAccessRoute({ authorize: () => Promise.resolve(staff), reveal });
    expect((await route(post({ confirm: true }), "../etc")).status).toBe(404);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("says why the rule refused, without any code", async () => {
    const route = createBoatAccessRoute({
      authorize: () => Promise.resolve(staff),
      reveal: () => Promise.reject(new AccessDeniedError("not_assigned")),
    });
    const response = await route(post({ confirm: true }), BOAT);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "access_denied", reason: "not_assigned" });

    const missing = createBoatAccessRoute({
      authorize: () => Promise.resolve(staff),
      reveal: () => Promise.reject(new AccessDeniedError("boat_not_found")),
    });
    expect((await missing(post({ confirm: true }), BOAT)).status).toBe(404);
  });
});
