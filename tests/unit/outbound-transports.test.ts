// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail, emailSendingEnabled } from "@/lib/email/send";
import { isGsm7, sendSms, smsSendingEnabled } from "@/lib/sms/send";
import { readDevMessages } from "@/lib/outbound/dev-outbox";

// The two ways a message leaves the app. What matters: nothing is sent unless
// a deployment is switched on for it, development NEVER sends (it records to
// the dev outbox instead), a misconfigured deployment fails loudly, and the
// provider gets exactly the request its API documents.

const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 201 }));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "info@squareshare.eu");
  vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "true");
  vi.stubEnv("SMS_SENDER", "Squareshare");
  vi.stubEnv("SMS_ENABLED", "true");
  vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
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
    await expect(sendEmail({ to: "a@b.eu", subject: "s", text: "t" })).rejects.toThrow(/BREVO_API_KEY/);
    await expect(sendSms({ to: "+353871234567", text: "t" })).rejects.toThrow(/BREVO_API_KEY/);
  });
});

describe("Brevo requests", () => {
  it("email: the documented transactional shape, key in the api-key header", async () => {
    expect(await sendEmail({ to: "hello@shop.eu", subject: "Hi", text: "Body" })).toEqual({ sent: true });
    const request = lastRequest();
    expect(request.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(request.headers["api-key"]).toBe("xkeysib-test");
    expect(request.body).toEqual({
      sender: { email: "info@squareshare.eu", name: "Squareshare" },
      to: [{ email: "hello@shop.eu" }],
      subject: "Hi",
      textContent: "Body",
    });
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
