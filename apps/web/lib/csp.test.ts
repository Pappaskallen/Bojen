import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, framesAllowed, newNonce } from "./csp";

describe("content security policy", () => {
  it("lets only scripts with the response's nonce run, never inline ones without it", () => {
    const policy = contentSecurityPolicy("abc123", false);
    const script = policy.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("leaves out frame-ancestors only for the booking pages", () => {
    expect(contentSecurityPolicy("n", true)).not.toContain("frame-ancestors");
    expect(framesAllowed("/boka/jonas-batservice")).toBe(true);
    expect(framesAllowed("/boka")).toBe(true);
    expect(framesAllowed("/bokat")).toBe(false);
    expect(framesAllowed("/kunder")).toBe(false);
  });

  it("makes a new 128-bit nonce each time", () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});
