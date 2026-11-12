import { describe, expect, it } from "vitest";
import { messages } from "../i18n/sv";
import {
  EMAIL_TEMPLATES,
  MissingVariableError,
  PUSH_TEMPLATES,
  SMS_TEMPLATES,
  countSegments,
  earliestSend,
  inQuietHours,
  optOutHash,
  planSms,
  renderEmail,
  renderPush,
  renderSms,
  toSmsCharacters,
  type EmailTemplateKey,
  type PushTemplateKey,
  type SmsTemplateKey,
} from ".";

/**
 * Test data on the long side of real life: a long firm name, a boat with a name, the
 * spec's 17-character short link and a two-word marina.
 */
const DATA: Record<string, string> = {
  code: "482913",
  firm: "Jonas Båtservice",
  firstName: "Christoffer",
  serviceShort: "Vinterkonservering",
  service: "Vinterkonservering inombordare",
  weekday: "ons",
  date: "22/10",
  newDate: "29/10",
  window: "08–12",
  placeShort: "Bullandö Marina",
  placeId: "B14",
  placeName: "Bullandö Marina",
  placeDetail: "brygga B, plats 14",
  mode: "i sjön",
  keyPlace: "nyckelskåpet",
  keyText: "Nyckel i nyckelskåpet vid hamnkontoret",
  link: "bojen.se/x/Kp3d9AB",
  googleLink: "g.page/r/CbXk3a9Q/review",
  boat: "Bustern",
  boatMake: "Nimbus",
  boatModel: "3000",
  engineMake: "Volvo Penta",
  engineModel: "D3-220",
  mechanicFirstName: "Jonas",
  mechanicName: "Jonas Lind",
  etaFrom: "09:00",
  etaTo: "11:00",
  eta: "10:15",
  amount: "4 250",
  week: "17",
  lastWeek: "18",
  discount: "10",
  reason: "12 mån sedan sist",
  emergencyPrice: "1 500",
  phone: "070-123 45 67",
  web: "jonasbatservice.se",
  customer: "Christoffer Andersson",
  place: "Bullandö Marina B14",
  symptomShort: "startar inte",
  photoCount: "2",
  priceIndication: "4 000–5 000",
  preparation: "Töm båten på värdesaker. Lämna tändnyckeln i nyckelskåpet.",
  cancelBy: "tis 21/10 kl 12",
  workDone: "Bytt motorolja och oljefilter.",
  hours: "412",
  previousHours: "356",
  parts: "21951346 · Oljefilter · 1",
  recommendations: "Inför nästa säsong: byt bälgar, uppskattat 3 200 kr",
  galleryLink: "bojen.se/x/G7h2kLm",
  dueDate: "15/11",
  paymentLink: "bojen.se/x/P9q4rSt",
  nextService: "våren 2027 eller 450 h",
  bookLink: "bojen.se/x/B1c2dEf",
  otherLink: "bojen.se/x/A3b4cDe",
  serviceContents: "Avkonservering, impeller, kontroll av anoder och provkörning.",
  openRecommendations: "Byt bälgar",
  reservedUntil: "24/1",
};

const smsKeys = Object.keys(SMS_TEMPLATES) as SmsTemplateKey[];

describe("sms templates", () => {
  it("covers every sms text in sv.ts", () => {
    expect(smsKeys.sort()).toEqual(Object.keys(messages.sms).sort());
  });

  it.each(smsKeys)("%s renders with test data within its segment limit, as GSM-7", (key) => {
    const rendered = renderSms(key, DATA as never);
    expect(rendered.body).not.toMatch(/[{}]/);
    expect(rendered.encoding).toBe("gsm7");
    expect(rendered.segments).toBeLessThanOrEqual(SMS_TEMPLATES[key].maxSegments);
  });

  it("swaps the dash in the time window so the sms stays GSM-7", () => {
    const rendered = renderSms("f5_eta", {
      mechanicFirstName: "Jonas",
      boat: "Bustern",
      placeShort: "Bullandö",
      etaFrom: "09:00",
      etaTo: "11:00",
      firm: "Jonas Båtservice",
    });
    expect(rendered.body).toBe(
      "God morgon! Jonas beräknas vara vid Bustern på Bullandö ca kl 09:00-11:00 i dag. /Jonas Båtservice",
    );
    expect(rendered).toMatchObject({ encoding: "gsm7", segments: 1 });
  });

  it("refuses to send a gap when a value is missing", () => {
    expect(() => renderSms("f6_on_way", { ...DATA, eta: "" } as never)).toThrow(
      MissingVariableError,
    );
  });

  it("only codes may break the quiet hours and STOPP", () => {
    const codes = smsKeys.filter((k) => SMS_TEMPLATES[k].category === "code");
    expect(codes.sort()).toEqual(["booking_code", "staff_sign_in_code"]);
  });
});

describe("e-mail and push templates", () => {
  it.each(Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[])("%s renders", (key) => {
    const email = renderEmail(key, DATA as never);
    expect(`${email.subject}${email.text}`).not.toMatch(/[{}]|\*\*/);
    expect(email.html).toContain("<strong>");
  });

  it("escapes values in the HTML", () => {
    const email = renderEmail("f1_confirmation", {
      ...DATA,
      firstName: "<script>alert(1)</script>",
    } as never);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.text).toContain("Hej <script>");
  });

  it("never carries an access code: only the one-time sign-in and booking codes", () => {
    const withCode = smsKeys.filter((k) => messages.sms[k].includes("{code}"));
    expect(withCode.sort()).toEqual(["booking_code", "staff_sign_in_code"]);
    expect(JSON.stringify(messages.email)).not.toContain("{code}");
    expect(messages.email.f1_confirmation.body).toContain("koden visas inte i e-post");
  });

  it.each(Object.keys(PUSH_TEMPLATES) as PushTemplateKey[])("%s renders", (key) => {
    expect(renderPush(key, DATA as never)).not.toMatch(/[{}]/);
  });
});

describe("segments", () => {
  it.each([
    ["", "gsm7", 1, 0],
    ["a".repeat(160), "gsm7", 1, 160],
    ["a".repeat(161), "gsm7", 2, 161],
    ["a".repeat(306), "gsm7", 2, 306],
    ["a".repeat(307), "gsm7", 3, 307],
    // Å, ä and ö are GSM-7: 159 of them fit in one sms, not the 70 the spec assumes.
    ["åäöÅÄÖ".repeat(26) + "åäö", "gsm7", 1, 159],
    ["€".repeat(80), "gsm7", 1, 160],
    ["€".repeat(81), "gsm7", 2, 162],
    ["ö".repeat(69) + "–", "ucs2", 1, 70],
    ["ö".repeat(70) + "–", "ucs2", 2, 71],
    ["x".repeat(134), "gsm7", 1, 134],
    ["👍" + "a".repeat(68), "ucs2", 1, 70],
    ["👍" + "a".repeat(69), "ucs2", 2, 71],
  ] as const)("%#: %s", (text, encoding, segments, units) => {
    expect(countSegments(text)).toEqual({ encoding, segments, units });
  });

  it("never splits an extension character across two segments", () => {
    // 152 plain characters and then €: the € does not fit in the first segment's last place.
    expect(countSegments(`${"a".repeat(152)}€${"a".repeat(10)}`).segments).toBe(2);
    expect(countSegments(`${"a".repeat(152)}€${"a".repeat(152)}`).segments).toBe(3);
    expect(countSegments(`${"a".repeat(153)}€${"a".repeat(151)}`).segments).toBe(2);
  });

  it("maps typographic characters to GSM-7 look-alikes", () => {
    expect(toSmsCharacters("”Hej” – kl 08–12 … ’ok’")).toBe("\"Hej\" - kl 08-12 ... 'ok'");
  });
});

describe("quiet hours and STOPP", () => {
  // 2026-11-12 is in winter time, UTC+1.
  const at = (stockholm: string) => new Date(`${stockholm}+01:00`);

  it("an sms at 22:30 waits until 08:00 the next morning", () => {
    expect(
      planSms({
        category: "notice",
        to: "+46701234567",
        optedOut: false,
        now: at("2026-11-12T22:30:00"),
      }),
    ).toEqual({
      action: "send",
      at: at("2026-11-13T08:00:00"),
    });
  });

  it("an sms at 06:10 waits until 08:00 the same morning, and 08:00 itself goes out", () => {
    expect(earliestSend(at("2026-11-12T06:10:00"), "marketing")).toEqual(at("2026-11-12T08:00:00"));
    expect(earliestSend(at("2026-11-12T08:00:00"), "notice")).toEqual(at("2026-11-12T08:00:00"));
    expect(inQuietHours(at("2026-11-12T20:59:00"))).toBe(false);
    expect(inQuietHours(at("2026-11-12T21:00:00"))).toBe(true);
  });

  it("F5 may go out at 07:00; other notices wait for 08:00", () => {
    const seven = at("2026-11-12T07:00:00");
    expect(earliestSend(seven, "notice", "07:00")).toEqual(seven);
    expect(earliestSend(seven, "notice")).toEqual(at("2026-11-12T08:00:00"));
    expect(earliestSend(at("2026-11-12T06:30:00"), "notice", "07:00")).toEqual(seven);
  });

  it("follows summer time", () => {
    const summer = new Date("2026-06-15T23:30:00+02:00");
    expect(earliestSend(summer, "notice")).toEqual(new Date("2026-06-16T08:00:00+02:00"));
  });

  it("codes and replies are not held at night", () => {
    const night = at("2026-11-12T23:15:00");
    expect(earliestSend(night, "code")).toEqual(night);
    expect(earliestSend(night, "reply")).toEqual(night);
  });

  it("a planned time in the future is kept, and moved out of the quiet hours", () => {
    const now = at("2026-11-12T10:00:00");
    expect(
      planSms({
        category: "notice",
        to: "+46701234567",
        optedOut: false,
        now,
        wanted: at("2026-11-12T21:30:00"),
      }),
    ).toEqual({ action: "send", at: at("2026-11-13T08:00:00") });
  });

  it("an sms to an opted-out number is stopped, except a code the person asked for", () => {
    const now = at("2026-11-12T10:00:00");
    for (const category of ["reply", "notice", "marketing"] as const) {
      expect(planSms({ category, to: "+46701234567", optedOut: true, now })).toEqual({
        action: "block",
        reason: "opted_out",
      });
    }
    expect(planSms({ category: "code", to: "+46701234567", optedOut: true, now })).toEqual({
      action: "send",
      at: now,
    });
    expect(planSms({ category: "notice", to: null, optedOut: false, now })).toEqual({
      action: "block",
      reason: "no_address",
    });
  });

  it("hashes opted-out numbers per firm with a secret key", () => {
    const a = optOutHash("key-1", "tenant-a", "+46701234567");
    expect(a).toBe(optOutHash("key-1", "tenant-a", "+46701234567"));
    expect(a).not.toBe(optOutHash("key-1", "tenant-b", "+46701234567"));
    expect(a).not.toBe(optOutHash("key-2", "tenant-a", "+46701234567"));
    expect(a).not.toContain("4670");
  });
});
