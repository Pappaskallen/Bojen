import { describe, expect, it, vi } from "vitest";
import type { StaffSession } from "./staff-auth";
import { createTasksRoute, type TasksRouteDeps } from "./tasks-route";

const TASK = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const session: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step: "none",
  accessToken: "token",
};

function route(over: Partial<TasksRouteDeps> = {}) {
  const deps: TasksRouteDeps = {
    session: () => Promise.resolve(session),
    decide: vi.fn(() => Promise.resolve(true)),
    subscribe: vi.fn(() => Promise.resolve()),
    unsubscribe: vi.fn(() => Promise.resolve()),
    ...over,
  };
  return { deps, route: createTasksRoute(deps) };
}

const decide = (what: string) => {
  const form = new FormData();
  form.set("do", what);
  return new Request(`http://localhost/api/arenden/${TASK}`, { method: "POST", body: form });
};
const push = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/push", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ", auth: "tBHItJI5svbpez7KI4CCXg" },
};

describe("the messages route", () => {
  it("takes or closes a message as the signed-in staff member", async () => {
    const { deps, route: r } = route();
    const taken = await r.decide(decide("take"), TASK);
    expect(taken.status).toBe(303);
    expect(taken.headers.get("location")).toBe("/idag/arenden");
    expect(deps.decide).toHaveBeenCalledWith({ tenantId: "t1", userId: "u1" }, TASK, "take");
    expect((await r.decide(decide("done"), TASK)).headers.get("location")).toBe("/idag/arenden");
  });

  it("says so when the message is gone, and refuses without a session", async () => {
    const { route: r } = route({ decide: () => Promise.resolve(false) });
    expect((await r.decide(decide("take"), TASK)).headers.get("location")).toBe(
      "/idag/arenden?arendefel=gone",
    );
    expect((await r.decide(decide("delete"), TASK)).headers.get("location")).toBe(
      "/idag/arenden?arendefel=gone",
    );
    const none = route({ session: () => Promise.resolve(null) });
    expect((await none.route.decide(decide("take"), TASK)).status).toBe(401);
    expect((await none.route.push(push(SUB))).status).toBe(401);
  });

  it("saves and removes this phone's push subscription", async () => {
    const { deps, route: r } = route();
    expect((await r.push(push(SUB))).status).toBe(204);
    expect(deps.subscribe).toHaveBeenCalledWith(
      { tenantId: "t1", userId: "u1" },
      { endpoint: SUB.endpoint, p256dh: SUB.keys.p256dh, auth: SUB.keys.auth },
    );
    expect((await r.push(push({ endpoint: SUB.endpoint }, "DELETE"))).status).toBe(204);
    expect(deps.unsubscribe).toHaveBeenCalledWith({ tenantId: "t1", userId: "u1" }, SUB.endpoint);
  });

  it("only takes push services' https addresses, never one inside our network", async () => {
    const { deps, route: r } = route();
    for (const endpoint of ["http://fcm.googleapis.com/x", "https://localhost/x", "https://10.0.0.5/x", "nope"]) {
      expect((await r.push(push({ ...SUB, endpoint }))).status).toBe(400);
    }
    expect((await r.push(push({ endpoint: SUB.endpoint, keys: { p256dh: "x", auth: "<>" } }))).status).toBe(400);
    expect(deps.subscribe).not.toHaveBeenCalled();
  });
});
