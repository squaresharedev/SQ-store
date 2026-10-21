// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail, emailSendingEnabled } from "@/lib/email/send";
import { isGsm7, sendSms, smsSendingEnabled } from "@/lib/sms/send";
import { readDevMessages } from "@/lib/outbound/dev-outbox";

// Email leaves over SMTP (lib/email/smtp.ts), SMS over Brevo's REST API.
const sendMailMock = vi.hoisted(() => vi.fn(async (_cfg: unknown, _message: unknown) => "250 queued"));
vi.mock("@/lib/email/smtp", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/email/smtp")>()),
  sendMail: sendMailMock,
}));

// The two ways a message leaves the app. What matters: nothing is sent unless
// a deployment is switched on for it, development NEVER sends (it records to
// the dev outbox instead), a misconfigured deployment fails loudly, and the
// provider gets exactly the request its API documents.

const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 201 }));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  sendMailMock.mockClear();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "info@squareshare.eu");
  vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "true");
  vi.stubEnv("SMS_SENDER", "Squareshare");
  vi.stubEnv("SMS_ENABLED", "true");
  vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
  vi.stubEnv("BREVO_SMTP_USER", "login@smtp-brevo.com");
  vi.stubEnv("BREVO_SMTP_KEY", "xsmtpsib-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
};

describe("switching on", () => {
  it("sends nothing until a deployment says to", async () => {
    vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "");
    vi.stubEnv("SMS_ENABLED", "");
    expect(emailSendingEnabled()).toBe(false);
    expect(smsSendingEnabled()).toBe(false);
    expect(await sendEmail({ to: "a@b.eu", subject: "s", text: "t" })).toEqual({
      sent: false,
      reason: "disabled",
    });
    expect(await sendSms({ to: "+353871234567", text: "t" })).toEqual({ sent: false, reason: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses loudly when switched on without the key", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("BREVO_SMTP_KEY", "");
    await expect(sendEmail({ to: "a@b.eu", subject: "s", text: "t" })).rejects.toThrow(/BREVO_SMTP_KEY/);
    expect(sendMailMock).not.toHaveBeenCalled();
    await expect(sendSms({ to: "+353871234567", text: "t" })).rejects.toThrow(/BREVO_API_KEY/);
  });
});

describe("Brevo requests", () => {
  it("email: handed to the relay with the login, the sender and the message", async () => {
    expect(await sendEmail({ to: "hello@shop.eu", subject: "Hi", text: "Body" })).toEqual({ sent: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalledWith(
      { host: "smtp-relay.brevo.com", port: 587, user: "login@smtp-brevo.com", pass: "xsmtpsib-test" },
      { fromName: "Squareshare", fromAddress: "info@squareshare.eu", to: ["hello@shop.eu"], subject: "Hi", text: "Body" },
    );
  });

  it("email: a seller's reply-to and an HTML part travel with it", async () => {
    await sendEmail({ to: "buyer@shop.eu", subject: "Shipped", text: "t", html: "<p>t</p>", replyTo: "seller@shop.eu" });
    expect(sendMailMock.mock.calls[0][1]).toMatchObject({ replyTo: "seller@shop.eu", html: "<p>t</p>" });
  });

  it("email: a refusal from the relay is a result, and the message body is never logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValueOnce(new Error("SMTP expected 250, got: 554 rejected"));
    const result = await sendEmail({ to: "a@b.eu", subject: "s", text: "SECRET-CODE 12345678" });
    expect(result).toMatchObject({ sent: false, reason: "failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET-CODE");
    log.mockRestore();
  });

  it("sms: transactional, GSM-7 when it can be, Unicode when it must", async () => {
    await sendSms({ to: "+353871234567", text: "12345678 is your code" });
    expect(lastRequest().url).toBe("https://api.brevo.com/v3/transactionalSMS/sms");
    expect(lastRequest().body).toMatchObject({
      sender: "Squareshare",
      recipient: "+353871234567",
      content: "12345678 is your code",
      type: "transactional",
      unicodeEnabled: false,
    });

    await sendSms({ to: "+48601234567", text: "12345678 to Twój kod. Nie udostępniaj go." });
    expect(lastRequest().body.unicodeEnabled).toBe(true);
  });

  it("a refusal from the provider is a result, and the message body is never logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response('{"code":"not_enough_credits"}', { status: 402 }));
    const result = await sendSms({ to: "+353871234567", text: "SECRET-CODE 12345678" });
    expect(result).toMatchObject({ sent: false, reason: "failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET-CODE");
    log.mockRestore();
  });
});

describe("development", () => {
  it("never sends: both channels go to the dev outbox instead", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "");
    vi.stubEnv("SMS_ENABLED", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendEmail({ to: "dev@shop.eu", subject: "Code", text: "1234 5678" });
    await sendSms({ to: "+353870000001", text: "12345678" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readDevMessages({ channel: "email", to: "dev@shop.eu" })[0]).toMatchObject({ text: "1234 5678" });
    expect(readDevMessages({ channel: "sms", to: "+353870000001" })[0]).toMatchObject({ text: "12345678" });
    info.mockRestore();
  });

  it("and outside development the outbox records nothing", async () => {
    await sendSms({ to: "+353870000002", text: "12345678" });
    vi.stubEnv("NODE_ENV", "development");
    expect(readDevMessages({ to: "+353870000002" })).toEqual([]);
  });
});

describe("isGsm7", () => {
  it("knows the basic alphabet from what needs Unicode", () => {
    expect(isGsm7("Twój kod: 12345678")).toBe(false); // ó is not GSM-7
    expect(isGsm7("Ihr Code: 12345678. Gültig 15 Min.")).toBe(true); // ü is GSM-7
    expect(isGsm7("Kód: 12345678, platí 15 min")).toBe(false); // í is not
  });
});
