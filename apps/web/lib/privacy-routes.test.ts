import { describe, expect, it, vi } from "vitest";
import { createPrivacyRoutes, type PrivacyRouteDeps } from "./privacy-routes";
import type { StaffSession } from "./staff-auth";

const CUSTOMER = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const owner: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "owner",
  authUserId: "a1",
  aal: "aal2",
  factorIds: [],
  step: "none",
  accessToken: "token",
};
const mechanic: StaffSession = { ...owner, role: "mechanic", aal: "aal1" };

function routes(over: Partial<PrivacyRouteDeps> = {}) {
  const deps: PrivacyRouteDeps = {
    session: () => Promise.resolve(owner),
    exportCustomer: vi.fn(() => Promise.resolve({ customer: { name: "Anna" } })),
    erase: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  return { deps, routes: createPrivacyRoutes(deps) };
}

const get = () => new Request(`http://bojen.test/api/kunder/${CUSTOMER}/export`);
const post = (confirm?: string) => {
  const body = new FormData();
  if (confirm !== undefined) body.set("confirm", confirm);
  return new Request(`http://bojen.test/api/kunder/${CUSTOMER}/radera`, { method: "POST", body });
};

describe("export and erasure of a customer", () => {
  it("gives the owner the customer's data as a JSON file that is not cached", async () => {
    const { routes: r, deps } = routes();
    const response = await r.export(get(), CUSTOMER);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="kund-${CUSTOMER}.json"`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ customer: { name: "Anna" } });
    expect(deps.exportCustomer).toHaveBeenCalledWith("t1", CUSTOMER, "u1");
  });

  it("refuses a mechanic, a visitor and a malformed id, and says when there is no customer", async () => {
    expect(
      (await routes({ session: () => Promise.resolve(mechanic) }).routes.export(get(), CUSTOMER))
        .status,
    ).toBe(403);
    expect(
      (await routes({ session: () => Promise.resolve(null) }).routes.export(get(), CUSTOMER))
        .status,
    ).toBe(401);
    expect((await routes().routes.export(get(), "../x")).status).toBe(404);
    expect(
      (await routes({ exportCustomer: () => Promise.resolve(null) }).routes.export(get(), CUSTOMER))
        .status,
    ).toBe(404);
  });

  it("erases only after RADERA is written, and goes back to the list", async () => {
    const { routes: r, deps } = routes();
    const unconfirmed = await r.erase(post("ja"), CUSTOMER);
    expect(unconfirmed.headers.get("location")).toBe(`/kunder/${CUSTOMER}?fel=confirm`);
    expect(deps.erase).not.toHaveBeenCalled();
    expect((await r.erase(post(), CUSTOMER)).headers.get("location")).toBe(
      `/kunder/${CUSTOMER}?fel=confirm`,
    );

    const done = await r.erase(post(" radera "), CUSTOMER);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/kunder?raderad=1");
    expect(deps.erase).toHaveBeenCalledWith("t1", CUSTOMER, "u1");
  });

  it("does not let a mechanic erase, and says so when it fails", async () => {
    const m = routes({ session: () => Promise.resolve(mechanic) });
    expect((await m.routes.erase(post("RADERA"), CUSTOMER)).headers.get("location")).toBe(
      `/kunder/${CUSTOMER}?fel=forbidden`,
    );
    expect(m.deps.erase).not.toHaveBeenCalled();

    const failing = routes({ erase: () => Promise.reject(new Error("db down +46701234567")) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await failing.routes.erase(post("RADERA"), CUSTOMER)).headers.get("location")).toBe(
      `/kunder/${CUSTOMER}?fel=failed`,
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain("+46701234567");
    errors.mockRestore();
    expect(
      (await routes({ erase: () => Promise.resolve(false) }).routes.erase(post("RADERA"), CUSTOMER))
        .status,
    ).toBe(404);
  });
});
