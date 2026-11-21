import { describe, expect, it } from "vitest";
import {
  ElksError,
  createElksSms,
  createFakeEmail,
  createSesEmail,
  sesEmailFromEnv,
  type SesSender,
  parseElksDeliveryReport,
} from ".";

/** A fetch that records the request and answers with `status` and `body`. */
function recorder(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const form = (init: RequestInit) => new URLSearchParams(String(init.body));

describe("46elks", () => {
  it("posts the sms as a form with basic auth and the delivery url", async () => {
    const { calls, fetch } = recorder(200, {
      id: "s70df59406a1b4643b96f3f91e0bfb7b0",
      status: "created",
    });
    const sms = createElksSms({
      username: "u123",
      password: "secret",
      from: "JonasBat",
      deliveryUrl: "https://app.bojen.se/api/webhooks/elks/delivery?token=t",
      fetch,
    });
    await expect(
      sms.send({ to: "+46701234567", body: "Hej Per! /Jonas Båtservice" }),
    ).resolves.toEqual({
      id: "s70df59406a1b4643b96f3f91e0bfb7b0",
    });
    const call = calls[0];
    expect(call?.url).toBe("https://api.46elks.com/a1/sms");
    expect(new Headers(call?.init.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("u123:secret").toString("base64")}`,
    );
    expect(Object.fromEntries(form(call?.init ?? {}))).toEqual({
      from: "JonasBat",
      to: "+46701234567",
      message: "Hej Per! /Jonas Båtservice",
      whendelivered: "https://app.bojen.se/api/webhooks/elks/delivery?token=t",
    });
  });

  it("uses the firm's own sender when given, and dry run when asked", async () => {
    const { calls, fetch } = recorder(200, { id: "s1" });
    await createElksSms({ username: "u", password: "p", from: "Bojen", dryRun: true, fetch }).send({
      to: "+46701234567",
      body: "x",
      from: "+46766860000",
    });
    expect(form(calls[0]?.init ?? {}).get("from")).toBe("+46766860000");
    expect(form(calls[0]?.init ?? {}).get("dryrun")).toBe("yes");
  });

  it("throws on an error answer, without the password in the message", async () => {
    const { fetch } = recorder(403, "Insufficient funds");
    const error = await createElksSms({ username: "u", password: "hemligt", from: "Bojen", fetch })
      .send({ to: "+46701234567", body: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElksError);
    expect(String(error)).toContain("403");
    expect(String(error)).not.toContain("hemligt");
  });

  it("reads delivery reports", () => {
    expect(
      parseElksDeliveryReport(
        new URLSearchParams({
          id: "s1",
          status: "delivered",
          delivered: "2026-11-12T09:15:02.123000",
        }),
      ),
    ).toEqual({ id: "s1", status: "delivered", delivered: new Date("2026-11-12T09:15:02.123Z") });
    expect(parseElksDeliveryReport(new URLSearchParams({ id: "s2", status: "failed" }))).toEqual({
      id: "s2",
      status: "failed",
      delivered: null,
    });
    expect(parseElksDeliveryReport(new URLSearchParams({ id: "s3", status: "weird" }))).toBeNull();
    expect(parseElksDeliveryReport(new URLSearchParams({ status: "delivered" }))).toBeNull();
  });
});

describe("Amazon SES", () => {
  const sesClient = (answer: { MessageId?: string } | Error) => {
    const sent: { input: unknown; options: unknown }[] = [];
    return {
      sent,
      client: {
        send: (command: { input: unknown }, options?: unknown) => {
          sent.push({ input: command.input, options });
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
      } as unknown as SesSender,
    };
  };

  it("sends text and html from the default sender, with a reply-to", async () => {
    const { client, sent } = sesClient({ MessageId: "0100-abc" });
    const email = createSesEmail({ client, from: "Bojen <noreply@bojen.se>" });
    await expect(
      email.send({
        to: "per@example.test",
        subject: "Bokningsbekräftelse",
        text: "Hej",
        html: "<p>Hej</p>",
        replyTo: "jonas@example.test",
      }),
    ).resolves.toEqual({ id: "0100-abc" });
    expect(sent[0]?.input).toEqual({
      FromEmailAddress: "Bojen <noreply@bojen.se>",
      Destination: { ToAddresses: ["per@example.test"] },
      ReplyToAddresses: ["jonas@example.test"],
      Content: {
        Simple: {
          Subject: { Data: "Bokningsbekräftelse", Charset: "UTF-8" },
          Body: {
            Text: { Data: "Hej", Charset: "UTF-8" },
            Html: { Data: "<p>Hej</p>", Charset: "UTF-8" },
          },
        },
      },
    });
  });

  it("uses the message's own sender, and fails without a message id or on an error", async () => {
    const own = sesClient({ MessageId: "id" });
    await createSesEmail({ client: own.client, from: "f@bojen.se" }).send({
      from: "Jonas <jonas@bojen.se>",
      to: "a@b.test",
      subject: "s",
      text: "t",
      html: "h",
    });
    expect(own.sent[0]?.input).toMatchObject({ FromEmailAddress: "Jonas <jonas@bojen.se>" });
    expect(own.sent[0]?.input).not.toHaveProperty("ReplyToAddresses");

    const message = { to: "a@b.test", subject: "s", text: "t", html: "h" };
    await expect(
      createSesEmail({ client: sesClient({}).client, from: "f" }).send(message),
    ).rejects.toThrow(/no message id/);
    await expect(
      createSesEmail({ client: sesClient(new Error("throttled")).client, from: "f" }).send(message),
    ).rejects.toThrow("throttled");
  });

  it("is used only when SES_FROM is set", () => {
    expect(sesEmailFromEnv({})).toBeNull();
    expect(sesEmailFromEnv({ SES_FROM: "Bojen <noreply@bojen.se>" })).not.toBeNull();
  });

  it("the fake keeps what it was asked to send", async () => {
    const fake = createFakeEmail();
    await fake.send({ to: "a@b.test", subject: "s", text: "t", html: "h" });
    expect(fake.sent).toEqual([
      { id: "fake-email-1", to: "a@b.test", subject: "s", text: "t", html: "h" },
    ]);
  });
});
