import { chromium, expect, test } from "@playwright/test";
import lighthouse from "lighthouse";

const PORT = 9223;
const RUNS = 3;
const METRICS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
] as const;

/**
 * Lighthouse on the booking page with its default mobile settings (a mid-range phone on a
 * slow 4G connection). Byggplan step 2.5 asks for at least 90 in performance. One run varies
 * by several points on a busy machine, so the median of three runs is used, as Lighthouse
 * itself recommends.
 */
test("the booking page scores at least 90 for performance on mobile", async ({ baseURL }) => {
  test.setTimeout(300_000);
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${String(PORT)}`] });
  try {
    const scores: { performance: number; accessibility: number }[] = [];
    for (let run = 0; run < RUNS; run++) {
      const result = await lighthouse(`${baseURL ?? ""}/boka/jonas-batservice`, {
        port: PORT,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility"],
      });
      const lhr = result?.lhr;
      const performance = Math.round((lhr?.categories.performance?.score ?? 0) * 100);
      const accessibility = Math.round((lhr?.categories.accessibility?.score ?? 0) * 100);
      scores.push({ performance, accessibility });
      const metrics = METRICS.map((id) => `${id} ${lhr?.audits[id]?.displayValue ?? "?"}`).join(
        ", ",
      );
      console.info(
        `Lighthouse run ${String(run + 1)}: performance ${String(performance)} (${metrics})`,
      );
    }
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    const performance = median(scores.map((s) => s.performance));
    const accessibility = median(scores.map((s) => s.accessibility));
    console.info(
      `Lighthouse mobile, median of ${String(RUNS)}: performance ${String(performance)}, accessibility ${String(accessibility)}`,
    );
    expect(performance).toBeGreaterThanOrEqual(90);
    expect(accessibility).toBeGreaterThanOrEqual(90);
  } finally {
    await browser.close();
  }
});
