import { CampaignError } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { campaignInput, createCampaignRoutes, type CampaignRouteDeps } from "./campaign-routes";
import type { StaffSession } from "./staff-auth";

const SERVICE = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const LAYUP = "7f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const CAMPAIGN = "8f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const owner: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "owner",
  authUserId: "a1",
  aal: "aal2",
  factorIds: [],
  step: "none",
  accessToken: "token",
};

function routes(over: Partial<CampaignRouteDeps> = {}) {
  const deps: CampaignRouteDeps = {
    session: () => Promise.resolve(owner),
    create: vi.fn(() => Promise.resolve(CAMPAIGN)),
    start: vi.fn(() => Promise.resolve({ recipients: 3 })),
    ...over,
  };
  return { deps, r: createCampaignRoutes(deps) };
}

const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};
const FIELDS: [string, string][] = [
  ["name", "Vårkampanj 2027"],
  ["year", "2027"],
  ["startDate", "2027-01-10"],
  ["spring", SERVICE],
  ["layUp", LAYUP],
  ["layUp", "inte-ett-id"],
  ["bookService", SERVICE],
  ["batchSize", "40"],
  ["defaultWeek", "16"],
  ["discount", "10,5"],
];
const post = (path: string, fields: [string, string][]) =>
  new Request(`http://localhost${path}`, { method: "POST", body: form(fields) });

describe("the campaign forms", () => {
  it("read the new campaign: the start at 18:30, the services, and a discount with a comma", () => {
    expect(campaignInput(form(FIELDS))).toEqual({
      name: "Vårkampanj 2027",
      year: 2027,
      scheduledAt: new Date("2027-01-10T17:30:00.000Z"),
      springServiceIds: [SERVICE],
      layUpServiceIds: [LAYUP],
      bookServiceTypeId: SERVICE,
      batchSize: 40,
      defaultWeek: 16,
      discountPercent: 10.5,
    });
  });

  it("create a draft and start it, for the owner", async () => {
    const { deps, r } = routes();
    const created = await r.create(post("/api/kampanjer", FIELDS));
    expect(created.headers.get("location")).toBe(`/kampanjer/${CAMPAIGN}?klart=skapad`);
    expect(deps.create).toHaveBeenCalledWith("t1", expect.objectContaining({ year: 2027 }));
    const started = await r.start(post(`/api/kampanjer/${CAMPAIGN}/starta`, []), CAMPAIGN);
    expect(started.headers.get("location")).toBe(`/kampanjer/${CAMPAIGN}?klart=startad`);
    expect(deps.start).toHaveBeenCalledWith("t1", CAMPAIGN);
  });

  it("are refused to a mechanic, to someone signed out, and say what was wrong", async () => {
    const mechanic = routes({ session: () => Promise.resolve({ ...owner, role: "mechanic" }) });
    const refused = await mechanic.r.create(post("/api/kampanjer", FIELDS));
    expect(refused.headers.get("location")).toBe("/kampanjer?fel=forbidden");
    expect(mechanic.deps.create).not.toHaveBeenCalled();
    const out = routes({ session: () => Promise.resolve(null) });
    expect((await out.r.start(post("/x", []), CAMPAIGN)).status).toBe(401);

    const again = routes({ start: () => Promise.reject(new CampaignError("wrong_state")) });
    expect((await again.r.start(post("/x", []), CAMPAIGN)).headers.get("location")).toBe(
      `/kampanjer/${CAMPAIGN}?fel=wrong_state`,
    );
    const bad = routes();
    const missing = await bad.r.create(post("/api/kampanjer", [["name", "x"]]));
    expect(missing.headers.get("location")).toBe("/kampanjer?fel=invalid_input");
  });
});
