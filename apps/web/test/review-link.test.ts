import { describe, expect, it } from "vitest";
import { createReviewLinkRoute } from "../lib/review-link-route";

const REVIEW = "https://g.page/r/jonas-batservice/review";

describe("the review link /r/{code} (F9, KPI 18)", () => {
  it("goes on to the firm's review page, uncached and without a referrer", async () => {
    const opened: string[] = [];
    const route = createReviewLinkRoute({
      open: (code) => {
        opened.push(code);
        return Promise.resolve(REVIEW);
      },
    });
    const response = await route("AbC12xYz");
    expect(opened).toEqual(["AbC12xYz"]);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(REVIEW);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("says so in Swedish when the link no longer works", async () => {
    const route = createReviewLinkRoute({ open: () => Promise.resolve(null) });
    const response = await route("Zz9Zz9Zz");
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("Länken till recensionen fungerar inte längre");
  });
});
