import { describe, expect, it } from "vitest";
import {
  VOICE_TOOLS,
  VOICE_TOOL_NAMES,
  answersControl,
  openCallToken,
  openOffer,
  sealCallToken,
  sealOffer,
  type OfferedTime,
} from "./tools";

const SECRET = "voice-test-secret-that-is-long-enough-123";
const NOW = new Date("2027-04-20T08:00:00Z");

describe("the receptionist's tools", () => {
  it("are the tools of spec 8.2, with the control question, each with an input schema", () => {
    expect(VOICE_TOOLS.map((t) => t.name)).toEqual([...VOICE_TOOL_NAMES]);
    for (const t of VOICE_TOOLS) {
      expect(t.input_schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(t.description.length).toBeGreaterThan(20);
    }
    // Nothing the model can ask for is a code or an address to read out.
    const schemas = JSON.stringify(VOICE_TOOLS);
    expect(schemas).not.toMatch(/"(kod|code|keyLocation|nyckel)"\s*:/);
  });
});

describe("the call's token", () => {
  const claims = { callId: "c1", tenantId: "t1", expiresAt: NOW.getTime() + 60_000 };

  it("comes back as it was sealed, until it expires", () => {
    const token = sealCallToken(SECRET, claims);
    expect(openCallToken(SECRET, token, NOW)).toEqual(claims);
    expect(openCallToken(SECRET, token, new Date(claims.expiresAt))).toBeNull();
  });

  it("is refused when changed or signed with another key", () => {
    const token = sealCallToken(SECRET, claims);
    expect(openCallToken(SECRET, token.replace("t1", "t2"), NOW)).toBeNull();
    expect(openCallToken("another-secret-that-is-long-enough-1234", token, NOW)).toBeNull();
    expect(openCallToken(SECRET, "inte-en-token", NOW)).toBeNull();
  });
});

describe("offered times", () => {
  const offer: OfferedTime = {
    callId: "c1",
    serviceTypeId: "s1",
    mechanicId: "m1",
    start: "2027-04-21T06:00:00.000Z",
    mode: "water",
    place: { locationId: "l1" },
  };

  it("can only be booked in the call that was offered them, unchanged", () => {
    const id = sealOffer(SECRET, offer);
    expect(openOffer(SECRET, id, "c1")).toEqual(offer);
    expect(openOffer(SECRET, id, "c2")).toBeNull();
    const [body, signature] = id.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...offer, start: "2027-04-21T04:00:00.000Z" }),
    ).toString("base64url");
    expect(openOffer(SECRET, `${forged}.${signature}`, "c1")).toBeNull();
    expect(openOffer(SECRET, `${body}.${signature}.x`, "c1")).toBeNull();
  });
});

describe("the control question", () => {
  const facts = {
    boats: [{ name: "Bustern", make: "Nimbus", model: "3000" }],
    places: ["Bullandö Marina"],
  };

  it("is answered by the boat's name, its model or its marina, however it is written", () => {
    expect(answersControl("Det gäller Bustern", facts)).toBe(true);
    expect(answersControl("en nimbus 3000", facts)).toBe(true);
    expect(answersControl("den ligger på bullando", facts)).toBe(true);
    expect(answersControl("BULLANDÖ marina", facts)).toBe(true);
  });

  it("is not answered by the make alone, by part of a word, or by nothing", () => {
    expect(answersControl("en Nimbus", facts)).toBe(false);
    expect(answersControl("Bustern2", facts)).toBe(false);
    expect(answersControl("Sandhamn", facts)).toBe(false);
    expect(answersControl("", facts)).toBe(false);
    expect(answersControl("marina", facts)).toBe(false);
  });
});
