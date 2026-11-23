import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  fortnoxCustomer,
  fortnoxInvoice,
  fortnoxSettings,
  invoicePayment,
  newAuthorization,
  parseBillingAddress,
} from "./fortnox";

describe("Fortnox authorization", () => {
  it("asks for the five scopes offline, with PKCE S256 and a state", () => {
    const a = newAuthorization();
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
    expect(newAuthorization().state).not.toBe(a.state);
    const url = new URL(
      authorizeUrl({
        clientId: "cid",
        redirectUri: "https://bojen.se/api/integrationer/fortnox/callback",
        state: a.state,
        challenge: a.challenge,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://apps.fortnox.se/oauth-v1/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      redirect_uri: "https://bojen.se/api/integrationer/fortnox/callback",
      scope: "customer article invoice payment companyinformation",
      state: a.state,
      access_type: "offline",
      response_type: "code",
      code_challenge: a.challenge,
      code_challenge_method: "S256",
    });
  });
});

describe("Fortnox settings", () => {
  it("keeps valid article numbers and a due time of 0–90 days, else 10 days", () => {
    expect(
      fortnoxSettings({
        fortnox: { articles: { labour: "101", part: "x y", callout: "FRAM" }, dueDays: 30 },
      }),
    ).toEqual({ articles: { labour: "101", callout: "FRAM" }, dueDays: 30 });
    expect(fortnoxSettings({})).toEqual({ articles: {}, dueDays: 10 });
    expect(fortnoxSettings({ fortnox: { dueDays: 400 } }).dueDays).toBe(10);
  });
});

describe("Fortnox customer", () => {
  it("splits the billing address into street, postcode and city", () => {
    expect(parseBillingAddress("Strandvägen 1\n11122 Stockholm")).toEqual({
      address1: "Strandvägen 1",
      zipCode: "111 22",
      city: "Stockholm",
    });
    expect(parseBillingAddress("Box 12, 134 60 Ingarö")).toEqual({
      address1: "Box 12",
      zipCode: "134 60",
      city: "Ingarö",
    });
    expect(parseBillingAddress("Bryggan vid sjön")).toEqual({ address1: "Bryggan vid sjön" });
    expect(parseBillingAddress(null)).toEqual({});
  });

  it("is a private customer in Sweden unless the firm says company", () => {
    expect(
      fortnoxCustomer({
        name: "Per Persson",
        type: "private",
        email: "per@example.se",
        phone: "+46701112233",
        billingAddress: "Strandvägen 1, 111 22 Stockholm",
      }),
    ).toEqual({
      Name: "Per Persson",
      Type: "PRIVATE",
      Email: "per@example.se",
      Phone1: "+46701112233",
      Address1: "Strandvägen 1",
      ZipCode: "111 22",
      City: "Stockholm",
      CountryCode: "SE",
    });
    expect(
      fortnoxCustomer({
        name: "Marinan AB",
        type: "company",
        email: null,
        phone: null,
        billingAddress: null,
      }),
    ).toEqual({ Name: "Marinan AB", Type: "COMPANY", CountryCode: "SE" });
  });
});

describe("Fortnox invoice", () => {
  it("is the approved basis excluding VAT, with the firm's articles and due date", () => {
    const invoice = fortnoxInvoice({
      customerNumber: "17",
      visitId: "v-1",
      day: "2027-03-28",
      boat: "Bustern, Nimbus 26",
      settings: { articles: { labour: "101", callout: "102" }, dueDays: 10 },
      lines: [
        { type: "labour", description: "Årsservice", quantity: 2.5, unitPriceOre: 95_000 },
        { type: "callout", description: "Framkörning", quantity: 1, unitPriceOre: 59_500 },
        { type: "discount", description: "Marinadag", quantity: 1, unitPriceOre: -59_500 },
      ],
    });
    expect(invoice).toEqual({
      CustomerNumber: "17",
      InvoiceDate: "2027-03-28",
      DueDate: "2027-04-07",
      VATIncluded: false,
      ExternalInvoiceReference1: "bojen:v-1",
      YourReference: "Bustern, Nimbus 26",
      InvoiceRows: [
        {
          ArticleNumber: "101",
          Description: "Årsservice",
          DeliveredQuantity: "2.5",
          Price: 950,
          VAT: 25,
        },
        {
          ArticleNumber: "102",
          Description: "Framkörning",
          DeliveredQuantity: "1",
          Price: 595,
          VAT: 25,
        },
        { Description: "Marinadag", DeliveredQuantity: "1", Price: -595, VAT: 25 },
      ],
    });
  });

  it("reads payment from the balance, and a cancelled invoice is not paid", () => {
    expect(invoicePayment({ Balance: 0, Cancelled: false })).toBe("paid");
    expect(invoicePayment({ Balance: 1187.5 })).toBe("open");
    expect(invoicePayment({ Balance: 0, Cancelled: true })).toBe("cancelled");
    expect(invoicePayment({})).toBe("open");
  });
});
