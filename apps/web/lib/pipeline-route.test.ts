import { PipelineError } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createPipelineRoute } from "./pipeline-route";
import type { StaffSession } from "./staff-auth";

const JOB = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const session = (step: StaffSession["step"] = "none"): StaffSession => ({
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step,
  accessToken: "token",
});
const post = (body: unknown) =>
  new Request(`http://127.0.0.1:3100/api/pipeline/${JOB}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("moving a pipeline card", () => {
  it("moves the card as the signed-in person, with their role", async () => {
    const move = vi.fn(() => Promise.resolve("quote"));
    const route = createPipelineRoute({ session: () => Promise.resolve(session()), move });
    const response = await route(post({ to: "quote" }), JOB);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "quote" });
    expect(move).toHaveBeenCalledWith(
      { tenantId: "t1", userId: "u1", role: "mechanic" },
      JOB,
      "quote",
    );
  });

  it("refuses someone signed out or halfway through the second factor", async () => {
    const move = vi.fn(() => Promise.resolve("quote"));
    for (const s of [null, session("challenge"), session("enroll")]) {
      const route = createPipelineRoute({ session: () => Promise.resolve(s), move });
      expect((await route(post({ to: "quote" }), JOB)).status).toBe(401);
    }
    expect(move).not.toHaveBeenCalled();
  });

  it("answers the rule's refusals with their status", async () => {
    for (const [code, status] of [
      ["forbidden", 403],
      ["not_found", 404],
      ["invalid_input", 400],
    ] as const) {
      const route = createPipelineRoute({
        session: () => Promise.resolve(session()),
        move: () => Promise.reject(new PipelineError(code)),
      });
      expect((await route(post({ to: "x" }), JOB)).status).toBe(status);
    }
    const route = createPipelineRoute({
      session: () => Promise.resolve(session()),
      move: () => Promise.resolve("x"),
    });
    expect((await route(post({ to: "quote" }), "not-an-id")).status).toBe(404);
  });
});
