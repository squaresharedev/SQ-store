// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageKey, MessageValues } from "@/i18n/types";
import { english } from "../setup/translate";

// Proving a seller owns the contact details buyers see: a code sent to the
// STORED value, typed back into their own session. These specs pin the
// guarantees the service makes before anything is sent and when a code comes
// back. The database half (the guard trigger, the locked redeem) is proven
// against a real Postgres in tests/integration/26-contact-verification.test.ts.

// ---- transports ------------------------------------------------------------

type Sent = { sent: true } | { sent: false; reason: "disabled" | "failed" };
const sendEmail = vi.fn(async (_m: { to: string; subject: string; text: string }): Promise<Sent> => ({ sent: true }));
const emailSendingEnabled = vi.fn(() => true);
vi.mock("@/lib/email/send", () => ({
  sendEmail: (m: { to: string; subject: string; text: string }) => sendEmail(m),
  emailSendingEnabled: () => emailSendingEnabled(),
}));
const sendSms = vi.fn(async (_m: { to: string; text: string }): Promise<Sent> => ({ sent: true }));
const smsSendingEnabled = vi.fn(() => true);
vi.mock("@/lib/sms/send", () => ({
  sendSms: (m: { to: string; text: string }) => sendSms(m),
  smsSendingEnabled: () => smsSendingEnabled(),
}));

// The message is worded in English here, from the real catalogue.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string, values?: MessageValues) =>
    english(`${namespace}.${key}` as MessageKey, values),
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

// ---- budgets ---------------------------------------------------------------

const rateLimit = vi.fn(async (_action: string, _budget: unknown) => true);
const rateLimitKey = vi.fn(async (_key: string, _action: string, _budget: unknown) => true);
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: (action: string, budget: unknown) => rateLimit(action, budget),
  rateLimitKey: (key: string, action: string, budget: unknown) => rateLimitKey(key, action, budget),
  clientKey: async () => "203.0.113.9",
}));

// ---- the database ----------------------------------------------------------

const profile: { row: Record<string, string | null> | null } = { row: null };
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  data: null as string | null,
  error: null as { code: string; message: string } | null,
}));
const pending: { rows: Record<string, unknown>[] } = { rows: [] };

function table(name: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => ({ data: profile.row, error: null }),
    then: (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: name === "contact_verifications" ? pending.rows : null, error: null }).then(resolve),
  };
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (name: string) => table(name),
    rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
  }),
}));

const { issueContactCode, redeemContactCode, pendingContactCodes } = await import(
  "@/lib/contact-verification/service"
);
const { hashContactCode, mintContactCode, formatContactCode } = await import(
  "@/lib/contact-verification/code"
);
const { CONTACT_CODE_MAX_ATTEMPTS, CONTACT_CODE_TTL_SECONDS } = await import(
  "@/lib/contact-verification/policy"
);

const OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EMAIL = "hello@studio-builderboy.at";
const PHONE = "+353871234567";
/** 32 bytes of 0x01, base64url: a test key, never a real one. */
const KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

const errorText = (result: { ok: boolean; error?: { message: { key: string; values?: MessageValues } } }) =>
  result.error ? english(result.error.message as never) : undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CONTACT_VERIFICATION_KEY", KEY);
  emailSendingEnabled.mockReturnValue(true);
  smsSendingEnabled.mockReturnValue(true);
  sendEmail.mockResolvedValue({ sent: true });
  sendSms.mockResolvedValue({ sent: true });
  rateLimit.mockResolvedValue(true);
  rateLimitKey.mockResolvedValue(true);
  profile.row = {
    seller_email: EMAIL,
    seller_email_verified_at: null,
    seller_phone: PHONE,
    seller_phone_verified_at: null,
  };
  // The database binds the code to the value it holds and hands it back.
  rpc.mockImplementation(async (fn, args) => ({
    data:
      fn === "issue_contact_verification"
        ? args.p_channel === "email"
          ? EMAIL
          : PHONE
        : "verified",
    error: null,
  }));
  pending.rows = [];
});

// ---- the code itself -------------------------------------------------------

describe("a contact code", () => {
  it("is 8 ASCII digits, uniform enough that no digit is favoured", () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 20_000; i += 1) {
      const code = mintContactCode();
      expect(code).toMatch(/^[0-9]{8}$/);
      counts[Number(code[0])] += 1;
    }
    // 2,000 expected per leading digit; a biased modulo would skew the low ones.
    for (const count of counts) expect(count).toBeGreaterThan(1_750);
  });

  it("is stored as an HMAC bound to the account and the channel", async () => {
    const hash = await hashContactCode(OWNER, "email", "12345678");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashContactCode(OWNER, "email", "12345678")).toBe(hash);
    // The same digits mean nothing for another account or channel.
    expect(await hashContactCode(OTHER, "email", "12345678")).not.toBe(hash);
    expect(await hashContactCode(OWNER, "phone", "12345678")).not.toBe(hash);
    expect(await hashContactCode(OWNER, "email", "12345679")).not.toBe(hash);
  });

  it("cannot be stored at all without a well-formed key", async () => {
    vi.stubEnv("CONTACT_VERIFICATION_KEY", "");
    expect(await hashContactCode(OWNER, "email", "12345678")).toBeNull();
    vi.stubEnv("CONTACT_VERIFICATION_KEY", "dG9vLXNob3J0"); // 9 bytes
    expect(await hashContactCode(OWNER, "email", "12345678")).toBeNull();
  });

  it("is written in two groups of four in a message", () => {
    expect(formatContactCode("12345678")).toBe("1234 5678");
  });
});

// ---- issuing ---------------------------------------------------------------

describe("issueContactCode", () => {
  it("emails the code to the value the DATABASE bound it to, storing only its hash", async () => {
    const result = await issueContactCode(OWNER, "email");

    expect(result).toEqual({ ok: true, status: "sent", target: EMAIL });
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("issue_contact_verification");
    expect(args).toMatchObject({ p_owner: OWNER, p_channel: "email", p_ttl_seconds: CONTACT_CODE_TTL_SECONDS });

    const mail = sendEmail.mock.calls[0]![0];
    expect(mail.to).toBe(EMAIL);
    const code = mail.text.match(/\b(\d{4}) (\d{4})\b/)!.slice(1).join("");
    expect(mail.subject).toContain(formatContactCode(code));
    // The raw code never reaches the database: only its MAC does.
    expect(JSON.stringify(args)).not.toContain(code);
    expect(args.p_code_hash).toBe(await hashContactCode(OWNER, "email", code));
  });

  it("texts a phone code unspaced, and names the number back formatted", async () => {
    const result = await issueContactCode(OWNER, "phone");

    expect(result).toEqual({ ok: true, status: "sent", target: "+353 87 123 4567" });
    const text = sendSms.mock.calls[0]![0];
    expect(text.to).toBe(PHONE);
    expect(text.text).toMatch(/^\d{8} is your Squareshare code/);
  });

  it("spends the account's own budgets before it even reads the profile", async () => {
    rateLimit.mockImplementation(async (action) => action !== "contact_code_cooldown_email");

    const result = await issueContactCode(OWNER, "email");

    expect(errorText(result)).toMatch(/code was just sent/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("caps one TARGET across every account, keyed on the channel and the value", async () => {
    rateLimitKey.mockImplementation(async (_key, action) => action !== "contact_code_target");

    const result = await issueContactCode(OWNER, "email");

    expect(errorText(result)).toMatch(/lot of codes/i);
    expect(rateLimitKey).toHaveBeenCalledWith(`email:${EMAIL}`, "contact_code_target", expect.anything());
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("caps one client, and the platform's daily texts", async () => {
    rateLimitKey.mockImplementation(async (_key, action) => action !== "contact_sms_platform");
    const result = await issueContactCode(OWNER, "phone");
    expect(errorText(result)).toMatch(/isn't available right now/i);
    expect(rateLimitKey).toHaveBeenCalledWith("203.0.113.9", "contact_code_client", expect.anything());
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("never spends the SMS ceiling on an email", async () => {
    await issueContactCode(OWNER, "email");
    expect(rateLimitKey.mock.calls.map((call) => call[1])).not.toContain("contact_sms_platform");
  });

  it("refuses when this deployment cannot prove the channel", async () => {
    smsSendingEnabled.mockReturnValue(false);
    expect(errorText(await issueContactCode(OWNER, "phone"))).toMatch(/isn't available/i);
    vi.stubEnv("CONTACT_VERIFICATION_KEY", "");
    expect(errorText(await issueContactCode(OWNER, "email"))).toMatch(/isn't available/i);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("has nothing to send when no value is stored, or it is already proven", async () => {
    profile.row = { ...profile.row!, seller_email: null };
    expect(errorText(await issueContactCode(OWNER, "email"))).toMatch(/Add a contact email/i);

    profile.row = { ...profile.row!, seller_phone_verified_at: "2026-09-26T10:00:00Z" };
    expect(await issueContactCode(OWNER, "phone")).toEqual({ ok: true, status: "alreadyConfirmed" });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("re-checks a stored email the form would refuse, however it got there", async () => {
    for (const email of ["hello@example.com", "someone@mailinator.com", "not-an-address"]) {
      profile.row = { ...profile.row!, seller_email: email };
      const result = await issueContactCode(OWNER, "email");
      expect(result.ok, email).toBe(false);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never texts a stored number outside the SMS regions, or one that cannot take a text", async () => {
    for (const phone of ["+19005550100", "+12025550143", "+442079460000"]) {
      profile.row = { ...profile.row!, seller_phone: phone };
      expect((await issueContactCode(OWNER, "phone")).ok, phone).toBe(false);
    }
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("asks for a number saved before normalisation to be saved again", async () => {
    profile.row = { ...profile.row!, seller_phone: "087 123 4567" };
    expect(errorText(await issueContactCode(OWNER, "phone"))).toMatch(/Save your phone number again/i);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends nothing when the value changed between the read and the bind", async () => {
    rpc.mockResolvedValue({ data: "someone-else@studio-builderboy.at", error: null });
    expect(errorText(await issueContactCode(OWNER, "email"))).toMatch(/changed/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports a delivery failure, and a misconfigured transport, without throwing", async () => {
    sendEmail.mockResolvedValueOnce({ sent: false, reason: "failed" });
    expect(errorText(await issueContactCode(OWNER, "email"))).toMatch(/couldn't send the email/i);

    sendEmail.mockRejectedValueOnce(new Error("BREVO_API_KEY is not set"));
    expect(errorText(await issueContactCode(OWNER, "email"))).toMatch(/isn't available/i);
  });
});

// ---- redeeming -------------------------------------------------------------

describe("redeemContactCode", () => {
  it("checks the MAC of the typed code, never the code, with the attempt ceiling", async () => {
    expect(await redeemContactCode(OWNER, "email", "12345678")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("redeem_contact_verification", {
      p_owner: OWNER,
      p_channel: "email",
      p_code_hash: await hashContactCode(OWNER, "email", "12345678"),
      p_max_attempts: CONTACT_CODE_MAX_ATTEMPTS,
    });
  });

  it.each([
    ["mismatch", /isn't right/i],
    ["locked", /Too many wrong tries/i],
    ["expired", /expired/i],
    ["none", /Send yourself a code first/i],
    ["stale", /changed after that code was sent/i],
    ["something-new", /couldn't check that code/i],
  ])("answers %s with its own next step", async (outcome, message) => {
    rpc.mockResolvedValue({ data: outcome, error: null });
    expect(errorText(await redeemContactCode(OWNER, "email", "12345678"))).toMatch(message);
  });

  it("is bounded per account before any database work", async () => {
    rateLimit.mockResolvedValue(false);
    expect(errorText(await redeemContactCode(OWNER, "phone", "12345678"))).toMatch(/Too many tries/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed on a database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    expect((await redeemContactCode(OWNER, "email", "12345678")).ok).toBe(false);
  });
});

describe("pendingContactCodes", () => {
  it("counts only live codes: unexpired, unconsumed, not burned by wrong guesses", async () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    pending.rows = [
      { channel: "email", expires_at: later, attempts: 0 },
      { channel: "phone", expires_at: earlier, attempts: 0 },
    ];
    expect(await pendingContactCodes(OWNER)).toEqual({ email: true, phone: false });

    pending.rows = [{ channel: "email", expires_at: later, attempts: CONTACT_CODE_MAX_ATTEMPTS }];
    expect(await pendingContactCodes(OWNER)).toEqual({ email: false, phone: false });
  });
});
