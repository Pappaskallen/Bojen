import { describe, expect, it } from "vitest";
import {
  ElksError,
  createElksSms,
  createFakeEmail,
  createSmtpEmail,
  smtpEmailFromEnv,
  type MailTransport,
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

describe("e-mail through our own mail server", () => {
  const transport = (answer: { messageId?: string } | Error) => {
    const sent: Parameters<MailTransport["sendMail"]>[0][] = [];
    return {
      sent,
      transport: {
        sendMail: (mail: Parameters<MailTransport["sendMail"]>[0]) => {
          sent.push(mail);
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
      },
    };
  };

  it("sends text and html from the default sender, with a reply-to", async () => {
    const t = transport({ messageId: "<abc@bojen.se>" });
    const email = createSmtpEmail({ transport: t.transport, from: "Bojen <noreply@bojen.se>" });
    await expect(
      email.send({
        to: "per@example.test",
        subject: "Bokningsbekräftelse",
        text: "Hej",
        html: "<p>Hej</p>",
        replyTo: "jonas@example.test",
      }),
    ).resolves.toEqual({ id: "<abc@bojen.se>" });
    expect(t.sent).toEqual([
      {
        from: "Bojen <noreply@bojen.se>",
        to: "per@example.test",
        subject: "Bokningsbekräftelse",
        text: "Hej",
        html: "<p>Hej</p>",
        replyTo: "jonas@example.test",
      },
    ]);
  });

  it("uses the message's own sender, and fails without a message id or on an error", async () => {
    const own = transport({ messageId: "id" });
    await createSmtpEmail({ transport: own.transport, from: "f@bojen.se" }).send({
      from: "Jonas <jonas@bojen.se>",
      to: "a@b.test",
      subject: "s",
      text: "t",
      html: "h",
    });
    expect(own.sent[0]).toMatchObject({ from: "Jonas <jonas@bojen.se>" });
    expect(own.sent[0]).not.toHaveProperty("replyTo");

    const message = { to: "a@b.test", subject: "s", text: "t", html: "h" };
    await expect(
      createSmtpEmail({ transport: transport({}).transport, from: "f" }).send(message),
    ).rejects.toThrow(/no message id/);
    await expect(
      createSmtpEmail({ transport: transport(new Error("refused")).transport, from: "f" }).send(
        message,
      ),
    ).rejects.toThrow("refused");
  });

  it("is used only when SMTP_HOST is set, and then needs an account", () => {
    expect(smtpEmailFromEnv({})).toBeNull();
    expect(() => smtpEmailFromEnv({ SMTP_HOST: "mail.bojen.se" })).toThrow(/SMTP_USER/);
    expect(
      smtpEmailFromEnv({
        SMTP_HOST: "mail.bojen.se",
        SMTP_USER: "noreply@bojen.se",
        SMTP_PASSWORD: "x",
      }),
    ).not.toBeNull();
  });

  it("the fake keeps what it was asked to send", async () => {
    const fake = createFakeEmail();
    await fake.send({ to: "a@b.test", subject: "s", text: "t", html: "h" });
    expect(fake.sent).toEqual([
      { id: "fake-email-1", to: "a@b.test", subject: "s", text: "t", html: "h" },
    ]);
  });
});
