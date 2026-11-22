import { describe, expect, it, vi } from "vitest";
import {
  createGlitchTipReporter,
  errorReporterFromEnv,
  noErrorReporter,
  parseDsn,
} from "./glitchtip";

const DSN = "https://abc123@fel.bojen.se/2";

function recorder(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response("{}", { status }));
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe("parseDsn", () => {
  it("gives the store address and the key", () => {
    expect(parseDsn(DSN)).toEqual({ storeUrl: "https://fel.bojen.se/api/2/store/", key: "abc123" });
    expect(() => parseDsn("https://fel.bojen.se/2")).toThrow(/not a DSN/);
    expect(() => parseDsn("https://abc@fel.bojen.se/")).toThrow(/not a DSN/);
  });
});

describe("createGlitchTipReporter", () => {
  it("sends a scrubbed event with the key in the auth header", async () => {
    const { calls, fetch } = recorder();
    const reporter = createGlitchTipReporter({
      dsn: DSN,
      service: "web",
      environment: "production",
      release: "0aca8d8",
      fetch,
      now: () => new Date("2026-11-22T10:00:00Z"),
    });
    await reporter.report(new Error("sms to +46701740680 failed"), {
      tags: { route: "/api/staff/kod", method: "POST" },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://fel.bojen.se/api/2/store/");
    expect(call?.init.method).toBe("POST");
    expect((call?.init.headers as Record<string, string>)["X-Sentry-Auth"]).toBe(
      "Sentry sentry_version=7, sentry_client=bojen/1.0, sentry_key=abc123",
    );
    const body = String(call?.init.body);
    expect(body).not.toContain("+4670");
    expect(JSON.parse(body)).toMatchObject({
      event_id: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown,
      release: "0aca8d8",
      environment: "production",
      tags: { service: "web", route: "/api/staff/kod", method: "POST" },
      exception: { values: [{ type: "Error", value: "sms to [nummer] failed" }] },
    });
  });

  it("sends the same error once a minute, not on every retry", async () => {
    const { calls, fetch } = recorder();
    let now = new Date("2026-11-22T10:00:00Z");
    const reporter = createGlitchTipReporter({
      dsn: DSN,
      service: "worker",
      environment: "production",
      fetch,
      now: () => now,
    });
    const fail = () => new Error("Photon answered 502");
    await reporter.report(fail(), { tags: { task: "send_message" } });
    await reporter.report(fail(), { tags: { task: "send_message" } });
    await reporter.report(fail(), { tags: { task: "visit_eta" } });
    expect(calls).toHaveLength(2);
    now = new Date("2026-11-22T10:01:01Z");
    await reporter.report(fail(), { tags: { task: "send_message" } });
    expect(calls).toHaveLength(3);
  });

  it("never throws when GlitchTip is down or refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const down = createGlitchTipReporter({
      dsn: DSN,
      service: "web",
      environment: "production",
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof globalThis.fetch,
    });
    await expect(down.report(new Error("a"))).resolves.toBeUndefined();
    const refusing = createGlitchTipReporter({
      dsn: DSN,
      service: "web",
      environment: "production",
      fetch: recorder(429).fetch,
    });
    await expect(refusing.report(new Error("b"))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("errorReporterFromEnv", () => {
  it("sends nothing without a DSN and refuses a broken one", () => {
    expect(errorReporterFromEnv("web", {})).toBe(noErrorReporter);
    expect(errorReporterFromEnv("web", { GLITCHTIP_DSN: DSN })).not.toBe(noErrorReporter);
    expect(() => errorReporterFromEnv("web", { GLITCHTIP_DSN: "nonsense" })).toThrow();
  });
});
