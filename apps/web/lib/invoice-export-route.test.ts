import { describe, expect, it, vi } from "vitest";
import { createInvoiceExportRoutes, type InvoiceExportRouteDeps } from "./invoice-export-route";
import type { StaffSession } from "./staff-auth";

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

function routes(over: Partial<InvoiceExportRouteDeps> = {}) {
  const deps: InvoiceExportRouteDeps = {
    session: () => Promise.resolve(owner),
    rows: vi.fn((_t: string, month: string) => Promise.resolve(month === "2027-03" ? [] : null)),
    markInvoiced: vi.fn((_t: string, month: string) =>
      Promise.resolve(month === "2027-03" ? 2 : null),
    ),
    ...over,
  };
  return { deps, r: createInvoiceExportRoutes(deps) };
}

const get = (month: string) =>
  new Request(`http://bojen.test/api/fakturaunderlag?manad=${month}`);
const post = (month: string) => {
  const body = new FormData();
  body.set("manad", month);
  return new Request("http://bojen.test/api/fakturaunderlag/fakturerat", { method: "POST", body });
};

describe("invoice export routes", () => {
  it("gives the owner the month as a CSV file that is not cached", async () => {
    const { r, deps } = routes();
    const response = await r.download(get("2027-03"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="fakturaunderlag-2027-03.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    // text() drops the byte order mark, so the bytes are read.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes).startsWith("Underlag;")).toBe(true);
    expect(deps.rows).toHaveBeenCalledWith("t1", "2027-03");
    expect((await r.download(get("mars"))).status).toBe(400);
  });

  it("is closed to mechanics and to anyone not signed in", async () => {
    const { r, deps } = routes({ session: () => Promise.resolve(mechanic) });
    expect((await r.download(get("2027-03"))).status).toBe(403);
    expect((await r.markInvoiced(post("2027-03"))).status).toBe(403);
    expect(deps.rows).not.toHaveBeenCalled();
    expect(deps.markInvoiced).not.toHaveBeenCalled();
    const anon = routes({ session: () => Promise.resolve(null) }).r;
    expect((await anon.download(get("2027-03"))).status).toBe(401);
  });

  it("marks the month invoiced and goes back to the pipeline", async () => {
    const { r } = routes();
    const done = await r.markInvoiced(post("2027-03"));
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/pipeline?fakturerat=2&manad=2027-03");
    expect((await r.markInvoiced(post("x"))).headers.get("location")).toBe(
      "/pipeline?fakturafel=1",
    );
  });
});
