import { createFakeErrorReporter } from "@bojen/adapters";
import { describe, expect, it } from "vitest";
import { reportRequestError } from "./errors";

describe("reportRequestError", () => {
  it("reports the route's pattern and method, not its path or headers", async () => {
    const reporter = createFakeErrorReporter();
    const error = new Error("render failed");
    await reportRequestError(
      reporter,
      error,
      { method: "GET" },
      { routerKind: "App Router", routePath: "/kunder/[id]", routeType: "render" },
    );
    expect(reporter.reported).toEqual([
      { error, tags: { route: "/kunder/[id]", routeType: "render", method: "GET" } },
    ]);
  });
});
