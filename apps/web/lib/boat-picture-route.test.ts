import { DayError } from "@bojen/db";
import { describe, expect, it, vi } from "vitest";
import { createBoatPictureRoute, type BoatPictureRouteDeps } from "./boat-picture-route";
import type { StaffSession } from "./staff-auth";

const VISIT = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";
const session: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step: "none",
  accessToken: "token",
};
const get = () => new Request(`http://localhost/api/idag/${VISIT}/batbild`);

function route(over: Partial<BoatPictureRouteDeps> = {}) {
  const deps: BoatPictureRouteDeps = {
    session: () => Promise.resolve(session),
    picture: vi.fn(() =>
      Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }),
    ),
    ...over,
  };
  return { deps, handle: createBoatPictureRoute(deps) };
}

describe("the boat picture on the day view", () => {
  it("is the picture, kept by the phone only", async () => {
    const { deps, handle } = route();
    const response = await handle(get(), VISIT);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(deps.picture).toHaveBeenCalledWith(
      { tenantId: "t1", userId: "u1", role: "mechanic" },
      VISIT,
    );
  });

  it("is not found when the boat has none, or the file is not a picture", async () => {
    expect(
      (await route({ picture: () => Promise.resolve(null) }).handle(get(), VISIT)).status,
    ).toBe(404);
    const html = route({
      picture: () => Promise.resolve({ bytes: new Uint8Array([1]), contentType: "text/html" }),
    });
    expect((await html.handle(get(), VISIT)).status).toBe(404);
  });

  it("is refused to someone signed out, or not on the visit", async () => {
    const signedOut = route({ session: () => Promise.resolve(null) });
    expect((await signedOut.handle(get(), VISIT)).status).toBe(401);
    expect(signedOut.deps.picture).not.toHaveBeenCalled();
    const other = route({ picture: () => Promise.reject(new DayError("forbidden")) });
    expect((await other.handle(get(), VISIT)).status).toBe(403);
    expect((await route().handle(get(), "inte-ett-id")).status).toBe(404);
  });
});
