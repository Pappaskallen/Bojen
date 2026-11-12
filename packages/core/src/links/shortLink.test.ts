import { describe, expect, it } from "vitest";
import {
  SHORT_CODE_LENGTH,
  isShortCode,
  linkHash,
  linkState,
  manageLinkExpiry,
  newShortCode,
  shortLinkUrl,
} from "./shortLink";

describe("short codes", () => {
  it("are 8 characters of A–Z, a–z and 0–9", () => {
    for (let i = 0; i < 200; i++) {
      const code = newShortCode();
      expect(code).toHaveLength(SHORT_CODE_LENGTH);
      expect(isShortCode(code)).toBe(true);
    }
  });

  it("are different every time", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => newShortCode()));
    expect(codes.size).toBe(1000);
  });

  it("throw away bytes from 248 up, so every character is equally likely", () => {
    // 248–255 are skipped; 0 gives A, 61 gives 9 and 62 wraps to A again.
    const bytes = [255, 248, 0, 61, 62, 1, 250, 26, 52, 2, 3, 4];
    let call = 0;
    const random = (size: number) => {
      call++;
      return Uint8Array.from({ length: size }, (_, i) => bytes[i] ?? 0);
    };
    expect(newShortCode(random)).toBe("A9ABa0CD");
    expect(call).toBe(1);
  });

  it("takes more bytes when too many are thrown away", () => {
    let call = 0;
    const random = (size: number) => {
      call++;
      return new Uint8Array(size).fill(call === 1 ? 255 : 27);
    };
    expect(newShortCode(random)).toBe("bbbbbbbb");
    expect(call).toBe(2);
  });

  it("refuse anything else in the URL", () => {
    for (const bad of ["", "AbC12", "AbC12xYz9", "AbC12xY-", "AbC12xY/", "../../etc", "åäöÅÄÖab"]) {
      expect(isShortCode(bad)).toBe(false);
    }
  });
});

describe("link hash", () => {
  it("depends on the key and the code, and is not the code", () => {
    const h = linkHash("key-one", "AbC12xYz");
    expect(h).toBe(linkHash("key-one", "AbC12xYz"));
    expect(h).not.toBe(linkHash("key-two", "AbC12xYz"));
    expect(h).not.toBe(linkHash("key-one", "AbC12xYZ"));
    expect(h).not.toContain("AbC12xYz");
  });
});

describe("link url", () => {
  it("writes bojen.se/x/{code} without a scheme", () => {
    expect(shortLinkUrl("https://bojen.se/", "AbC12xYz")).toBe("bojen.se/x/AbC12xYz");
    expect(shortLinkUrl("http://localhost:3000", "AbC12xYz")).toBe("localhost:3000/x/AbC12xYz");
    // 3 characters more than the spec's 5-character example (decided with Robert 2026-11-12).
    expect(shortLinkUrl("bojen.se", "AbC12xYz")).toHaveLength(19);
  });
});

describe("link state", () => {
  const expiresAt = new Date("2026-10-22T06:00:00Z");

  it("is valid until it expires", () => {
    expect(linkState({ expiresAt, usedAt: null }, new Date("2026-10-22T05:59:59Z"))).toBe("valid");
    expect(linkState({ expiresAt, usedAt: null }, expiresAt)).toBe("expired");
  });

  it("stays used after a change or a cancellation", () => {
    const usedAt = new Date("2026-10-20T10:00:00Z");
    expect(linkState({ expiresAt, usedAt }, new Date("2026-10-20T10:00:01Z"))).toBe("used");
    expect(linkState({ expiresAt, usedAt }, new Date("2026-10-23T00:00:00Z"))).toBe("used");
  });

  it("lets the customer manage a booking until it starts", () => {
    expect(manageLinkExpiry(expiresAt)).toEqual(expiresAt);
  });
});
