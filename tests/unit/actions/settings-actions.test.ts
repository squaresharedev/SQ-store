// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getUserMock = vi.fn();
// Only getUser is faked. revokeOtherSessions stays REAL so these specs assert
// the actual revocation call the action makes, not a stub of it.
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: () => getUserMock(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// next/headers is imported by settings/actions.ts even though none of the
// tested functions call siteOrigin(). Mock it to prevent side effects.
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn(() => null) }),
  cookies: vi.fn().mockResolvedValue({ set: vi.fn(), get: vi.fn() }),
}));

// Chainable fake Supabase client.
// settings/actions.ts uses direct-await on .eq() (no .single()/.maybeSingle()):
//   const { error } = await supabase.from("profiles").update({...}).eq("id", userId)
// So db must be thenable.
const dbFn = vi.fn();
const db: any = {};
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
  db[m] = vi.fn(() => db);
}
db.single = vi.fn(() => dbFn());
db.maybeSingle = vi.fn(() => dbFn());
// Thenable for direct-await (updateOwnProfile and updateUsername pattern)
db.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
  Promise.resolve(dbFn()).then(resolve, reject);
// Auth methods for changePassword
db.auth = {
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
};

// Non-thenable wrapper: prevents async () => db from unwrapping via thenable protocol.
// auth is delegated so supabase.auth.signInWithPassword/updateUser work in changePassword.
const clientWrapper = {
  from: (...args: unknown[]) => (db.from as (...a: unknown[]) => unknown)(...args),
  auth: db.auth,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clientWrapper,
}));

// The contact email's DOMAIN check talks to a public DNS resolver over HTTPS.
// Faked here so these specs never depend on the network; "unknown" is the
// real thing's own answer whenever the resolver does not reply, and it is the
// answer that accepts. One case below flips it to "no".
const mailExchangerMock = vi.fn(async () => "unknown" as string);
vi.mock("@/lib/validation/email-domain", () => ({
  hasMailExchanger: (...args: unknown[]) => mailExchangerMock(...(args as [])),
}));


// Rate limiting is exercised by its own tests; here it defaults to ALLOWED so
// these specs assert the action logic. Each file also has one case that flips
// it to denied, since the limiter fails closed and that path must be covered.
const rateLimitMock = vi.fn();
const rateLimitKeyMock = vi.fn();
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
  rateLimitKey: (...args: unknown[]) => rateLimitKeyMock(...args),
  clientKey: async () => "test-client",
}));

/**
 * The has-password lookup. It is the fix for a real hole: `identities` said no
 * for accounts that had a password, and requestEmailChange skips
 * re-authentication when it believes there is none.
 */
const hasPasswordMock = vi.fn();
vi.mock("@/lib/auth/has-password", () => ({
  accountHasPassword: (...args: unknown[]) => hasPasswordMock(...args),
}));

/** Audit + bell. Best-effort by contract, so specs assert it is CALLED but
 *  also that a failure never fails the credential change. */
const alertMock = vi.fn();
vi.mock("@/lib/security/events", () => ({
  alertSecurityEvent: (...args: unknown[]) => alertMock(...args),
}));

// ---- imports -------------------------------------------------------------

import {
  updateUsername,
  saveTaxInfo,
  saveNotifications,
  acceptLegal,
  requestAccountDeletion,
  cancelAccountDeletion,
  changePassword,
  requestEmailChange,
  sendPasswordReset,
} from "@/lib/settings/actions";
import { LEGAL_VERSION } from "@/lib/settings/constants";

// ---- test constants ------------------------------------------------------

const USER_ID = "10000000-0000-4000-8000-000000000001";
const USER = { id: USER_ID, email: "user@example.com" };
const PREV: { error?: string; success?: string } = {};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue(true);
  rateLimitKeyMock.mockResolvedValue(true);
  hasPasswordMock.mockResolvedValue(true);
  mailExchangerMock.mockResolvedValue("unknown");
  alertMock.mockResolvedValue(undefined);
  dbFn.mockResolvedValue({ error: null });
  for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
    db[m].mockReturnValue(db);
  }
  db.single.mockImplementation(() => dbFn());
  db.maybeSingle.mockImplementation(() => dbFn());
  db.auth.signInWithPassword.mockResolvedValue({ error: null });
  db.auth.updateUser.mockResolvedValue({ error: null });
  db.auth.getSession.mockResolvedValue({ data: { session: null } });
  db.auth.signOut.mockResolvedValue({ error: null });
  db.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

// ==========================================================================
// updateUsername
// ==========================================================================

describe("updateUsername - field whitelist", () => {
  it("injected 'is_seller' field is rejected, no DB write", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("username", "alice");
    fd.append("is_seller", "true"); // privilege-escalation attempt

    const result = await updateUsername(PREV, fd);

    expect(result.error).toMatch(/is_seller/);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("updateUsername - auth", () => {
  it("signed out returns session expired error", async () => {
    getUserMock.mockResolvedValue(null);
    const fd = new FormData();
    fd.append("username", "alice");
    const result = await updateUsername(PREV, fd);
    expect(result.error).toMatch(/session/i);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("updateUsername - validation", () => {
  it("empty username returns validation error", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("username", "");
    const result = await updateUsername(PREV, fd);
    expect(result.error).toBeTruthy();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("duplicate username (DB error code 23505) returns friendly 'taken' error", async () => {
    getUserMock.mockResolvedValue(USER);
    dbFn.mockResolvedValueOnce({ error: { code: "23505", message: "unique violation" } });
    const fd = new FormData();
    fd.append("username", "takenname");

    const result = await updateUsername(PREV, fd);

    expect(result.error).toMatch(/taken/i);
  });
});

describe("updateUsername - happy path", () => {
  it("success: update scoped to session user id", async () => {
    getUserMock.mockResolvedValue(USER);
    dbFn.mockResolvedValueOnce({ error: null });
    const fd = new FormData();
    fd.append("username", "alice");

    const result = await updateUsername(PREV, fd);

    expect(result.success).toBeTruthy();
    // Verify the update was scoped to the session user id
    const eqCalls = db.eq.mock.calls as [string, string][];
    expect(eqCalls.some(([col, val]) => col === "id" && val === USER_ID)).toBe(true);
  });
});

// ==========================================================================
// saveTaxInfo
// ==========================================================================

describe("saveTaxInfo - field whitelist", () => {
  it("injected 'is_seller' field is rejected, no DB write", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("tax_business_name", "ACME");
    fd.append("tax_vat_id", "DE123456789");
    fd.append("tax_country", "DE");
    fd.append("is_seller", "true");

    const result = await saveTaxInfo(PREV, fd);

    expect(result.error).toMatch(/is_seller/);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("saveTaxInfo - happy path", () => {
  it("update is scoped to session user id", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("tax_business_name", "ACME Corp");
    fd.append("tax_vat_id", "DE123456789");
    fd.append("tax_country", "DE");

    const result = await saveTaxInfo(PREV, fd);

    expect(result.success).toBeTruthy();
    const eqCalls = db.eq.mock.calls as [string, string][];
    expect(eqCalls.some(([col, val]) => col === "id" && val === USER_ID)).toBe(true);
  });

  it("writes the seller-identity fields alongside the tax ones", async () => {
    // These three are what lib/settings/seller-identity.ts reads into the
    // buyer-facing trader identity — the write path this test guards.
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("tax_business_name", "ACME Corp");
    fd.append("seller_address", "12 Market Street\nDublin, D02 X285");
    fd.append("seller_email", "hello@acme-prints.de");
    fd.append("tax_vat_id", "DE123456789");
    fd.append("tax_country", "DE");
    fd.append("seller_phone", "+353 1 234 5678");

    const result = await saveTaxInfo(PREV, fd);

    expect(result.success).toBeTruthy();
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.seller_address).toBe("12 Market Street\nDublin, D02 X285");
    expect(updatePayload.seller_email).toBe("hello@acme-prints.de");
    expect(updatePayload.seller_phone).toBe("+353 1 234 5678");
  });

  it("accepts a real <textarea>'s CRLF line breaks instead of rejecting them as header injection", async () => {
    // A browser's own form-data-set algorithm normalises a textarea's
    // newlines to CRLF before this action ever sees them (unlike every OTHER
    // multiline field in the app, which is React-controlled and never goes
    // through a native form submission). multiLineText rejects a bare CR on
    // purpose elsewhere — this proves that defence does not also swallow an
    // address typed into this one real textarea.
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("tax_business_name", "");
    fd.append("seller_address", "12 Market Street\r\nDublin, D02 X285");
    fd.append("seller_email", "");
    fd.append("tax_vat_id", "");
    fd.append("tax_country", "");
    fd.append("seller_phone", "");

    const result = await saveTaxInfo(PREV, fd);

    expect(result.success).toBeTruthy();
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    // Normalised to LF-only on the way in, same as every other stored value.
    expect(updatePayload.seller_address).toBe("12 Market Street\nDublin, D02 X285");
  });

  it("blank optional fields clear to null rather than storing empty strings", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("tax_business_name", "");
    fd.append("seller_address", "");
    fd.append("seller_email", "");
    fd.append("tax_vat_id", "");
    fd.append("tax_country", "");
    fd.append("seller_phone", "");

    const result = await saveTaxInfo(PREV, fd);

    expect(result.success).toBeTruthy();
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    for (const field of ["seller_address", "seller_email", "seller_phone"]) {
      expect(updatePayload[field]).toBeNull();
    }
  });

  it("rejects a contact email that doesn't look like one", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("tax_business_name", "");
    fd.append("seller_address", "");
    fd.append("seller_email", "not-an-email");
    fd.append("tax_vat_id", "");
    fd.append("tax_country", "");
    fd.append("seller_phone", "");

    const result = await saveTaxInfo(PREV, fd);

    expect(result.error).toMatch(/email/i);
    expect(db.update).not.toHaveBeenCalled();
  });

  // The address published to buyers is checked for being REACHABLE, not just
  // well-formed: it is what someone writes to about their order.
  function taxForm(seller_email: string) {
    const fd = new FormData();
    fd.append("tax_business_name", "ACME Corp");
    fd.append("seller_address", "12 Market Street");
    fd.append("seller_email", seller_email);
    fd.append("tax_vat_id", "");
    fd.append("tax_country", "");
    fd.append("seller_phone", "");
    return fd;
  }

  it("rejects a contact email at a placeholder or throwaway domain", async () => {
    getUserMock.mockResolvedValue(USER);

    for (const address of ["hello@example.com", "someone@mailinator.com", "test@acme-prints.de"]) {
      db.update.mockClear();
      const result = await saveTaxInfo(PREV, taxForm(address));
      expect(result.error, address).toBeTruthy();
      expect(db.update, address).not.toHaveBeenCalled();
    }
    // All three were settled without asking a resolver anything.
    expect(mailExchangerMock).not.toHaveBeenCalled();
  });

  it("rejects a contact email whose domain answers that it takes no mail", async () => {
    getUserMock.mockResolvedValue(USER);
    mailExchangerMock.mockResolvedValue("no");

    const result = await saveTaxInfo(PREV, taxForm("hello@acme-prints.de"));

    expect(result.error).toMatch(/doesn't accept mail/i);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("saves when the resolver cannot answer — the DNS check fails open", async () => {
    // The one part of this gate that depends on a third party being
    // reachable, so a timeout must not block a seller's real address.
    getUserMock.mockResolvedValue(USER);
    mailExchangerMock.mockResolvedValue("unknown");

    const result = await saveTaxInfo(PREV, taxForm("hello@acme-prints.de"));

    expect(result.success).toBeTruthy();
    expect(db.update).toHaveBeenCalled();
  });

  it("does not ask a resolver about an email that is being cleared", async () => {
    getUserMock.mockResolvedValue(USER);

    await saveTaxInfo(PREV, taxForm(""));

    expect(mailExchangerMock).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// saveNotifications
// ==========================================================================

describe("saveNotifications", () => {
  it("unknown field is rejected, no DB write", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("notify_sales", "on");
    fd.append("notify_product_updates", "on");
    fd.append("notify_marketing", "");
    fd.append("extra_field", "oops");

    const result = await saveNotifications(PREV, fd);

    expect(result.error).toMatch(/extra_field/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("success: updates notify columns for current user", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("notify_sales", "on");
    fd.append("notify_product_updates", "");
    fd.append("notify_marketing", "");

    const result = await saveNotifications(PREV, fd);

    expect(result.success).toBeTruthy();
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload).toHaveProperty("notify_sales", true);
    expect(updatePayload).toHaveProperty("notify_product_updates", false);
    expect(updatePayload).toHaveProperty("notify_marketing", false);
  });
});

// ==========================================================================
// acceptLegal
// ==========================================================================

describe("acceptLegal", () => {
  it("unknown field is rejected", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("version", LEGAL_VERSION);
    fd.append("extra", "nope");

    const result = await acceptLegal(PREV, fd);

    expect(result.error).toMatch(/extra/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("wrong version string returns validation error", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("version", "2020-old-version");

    const result = await acceptLegal(PREV, fd);

    expect(result.error).toBeTruthy();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("correct version sets legal_accepted_at and legal_accepted_version", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("version", LEGAL_VERSION);

    const result = await acceptLegal(PREV, fd);

    expect(result.success).toBeTruthy();
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updatePayload.legal_accepted_at).toBe("string");
    expect(updatePayload.legal_accepted_version).toBe(LEGAL_VERSION);
  });
});

// ==========================================================================
// requestAccountDeletion
// ==========================================================================

describe("requestAccountDeletion", () => {
  it("wrong confirm phrase returns validation error, no DB write", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("confirm", "please delete my stuff");

    const result = await requestAccountDeletion(PREV, fd);

    expect(result.error).toMatch(/delete my account/i);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("correct phrase sets deletion_requested_at on the profile", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("confirm", "delete my account");

    const result = await requestAccountDeletion(PREV, fd);

    expect(result.success).toBeTruthy();
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updatePayload.deletion_requested_at).toBe("string");
    // Scoped to the session user
    const eqCalls = db.eq.mock.calls as [string, string][];
    expect(eqCalls.some(([col, val]) => col === "id" && val === USER_ID)).toBe(true);
  });

  it("unknown field is rejected", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("confirm", "delete my account");
    fd.append("user_id", USER_ID);

    const result = await requestAccountDeletion(PREV, fd);

    expect(result.error).toMatch(/user_id/);
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// cancelAccountDeletion
// ==========================================================================

describe("cancelAccountDeletion", () => {
  it("success sets deletion_requested_at = null", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData(); // no fields expected

    const result = await cancelAccountDeletion(PREV, fd);

    expect(result.success).toBeTruthy();
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.deletion_requested_at).toBeNull();
  });

  it("unknown field is rejected", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("confirm", "yes");

    const result = await cancelAccountDeletion(PREV, fd);

    expect(result.error).toMatch(/confirm/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("signed out returns session expired error", async () => {
    getUserMock.mockResolvedValue(null);
    const fd = new FormData();
    const result = await cancelAccountDeletion(PREV, fd);
    expect(result.error).toMatch(/session/i);
  });
});

// ==========================================================================
// changePassword
// ==========================================================================

describe("changePassword", () => {
  function validPasswordForm() {
    const fd = new FormData();
    fd.append("current_password", "old-pass-word-1");
    fd.append("new_password", "new-pass-word-2");
    fd.append("confirm_password", "new-pass-word-2");
    return fd;
  }

  it("unknown field is rejected, no reauth attempted", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = validPasswordForm();
    fd.append("email", "hacker@example.com");

    const result = await changePassword(PREV, fd);

    expect(result.error).toMatch(/email/);
    expect(db.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("wrong current password: reauth fails, updateUser NOT called", async () => {
    getUserMock.mockResolvedValue(USER);
    db.auth.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid credentials" },
    });

    const result = await changePassword(PREV, validPasswordForm());

    expect(result.error).toMatch(/current password/i);
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("mismatched new passwords returns validation error", async () => {
    getUserMock.mockResolvedValue(USER);
    const fd = new FormData();
    fd.append("current_password", "old-pass-word-1");
    fd.append("new_password", "new-pass-word-2");
    fd.append("confirm_password", "different-pass-3");

    const result = await changePassword(PREV, fd);

    expect(result.error).toMatch(/match/i);
    expect(db.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("success: reauth succeeds then updateUser is called", async () => {
    getUserMock.mockResolvedValue(USER);
    db.auth.signInWithPassword.mockResolvedValue({ error: null });
    db.auth.updateUser.mockResolvedValue({ error: null });

    const result = await changePassword(PREV, validPasswordForm());

    expect(result.success).toBeTruthy();
    expect(db.auth.signInWithPassword).toHaveBeenCalledWith({
      email: USER.email,
      password: "old-pass-word-1",
    });
    expect(db.auth.updateUser).toHaveBeenCalledWith({
      password: "new-pass-word-2",
    });
  });

  it("signed out returns session expired error", async () => {
    getUserMock.mockResolvedValue(null);
    const result = await changePassword(PREV, validPasswordForm());
    expect(result.error).toMatch(/session/i);
    expect(db.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// Rate limits on signed-in writes
// ==========================================================================

describe("requestEmailChange - rate limit", () => {
  function emailForm(next = "new@example.com") {
    const fd = new FormData();
    fd.append("new_email", next);
    return fd;
  }

  it("sends the confirmation mail when the budget allows it", async () => {
    getUserMock.mockResolvedValue(USER);
    // This spec is about the BUDGET, so use an account with no password and
    // keep the re-auth gate (covered in its own block) out of the way.
    hasPasswordMock.mockResolvedValue(false);
    const result = await requestEmailChange(PREV, emailForm());
    expect(result.success).toBeTruthy();
    expect(db.auth.updateUser).toHaveBeenCalled();
  });

  it("refuses to send when the budget is spent", async () => {
    // This is the one signed-in action that mails an address the CALLER
    // chose, so an unbounded version can be aimed at a stranger's inbox.
    getUserMock.mockResolvedValue(USER);
    rateLimitMock.mockResolvedValue(false);

    const result = await requestEmailChange(PREV, emailForm());

    expect(result.error).toMatch(/too many/i);
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("spends the budget only on a valid, changed address", async () => {
    getUserMock.mockResolvedValue(USER);
    // Same address as the account: rejected before the budget is touched, so
    // a no-op request can't burn someone's allowance.
    await requestEmailChange(PREV, emailForm(USER.email));
    expect(rateLimitMock).not.toHaveBeenCalled();

    // Malformed address: likewise rejected first.
    await requestEmailChange(PREV, emailForm("not-an-email"));
    expect(rateLimitMock).not.toHaveBeenCalled();
  });
});

describe("settings writes - rate limit", () => {
  it("refuses a profile write when the budget is spent", async () => {
    getUserMock.mockResolvedValue(USER);
    rateLimitMock.mockResolvedValue(false);

    const fd = new FormData();
    fd.append("username", "valid_name");
    const result = await updateUsername(PREV, fd);

    expect(result.error).toMatch(/short time/i);
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// Account-takeover hardening
// ==========================================================================

/** A password-backed account: has an "email" identity to re-authenticate. */
const PASSWORD_USER = {
  ...USER,
  identities: [{ provider: "email" }],
};

/** An OAuth-only account: no password exists to ask for. */
const OAUTH_USER = {
  ...USER,
  identities: [{ provider: "google" }],
};

function emailChangeForm(email = "new@example.com", password?: string) {
  const fd = new FormData();
  fd.append("new_email", email);
  if (password !== undefined) fd.append("current_password", password);
  return fd;
}

describe("requestEmailChange - re-authentication", () => {
  // Whoever controls the account's address can request a password reset to it,
  // so a stolen session alone must not be able to move the address. Without
  // this gate the chain is: hijack session -> change email -> reset password.
  it("refuses without the current password on a password-backed account", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);

    const result = await requestEmailChange(PREV, emailChangeForm());

    expect(result.error).toMatch(/current password/i);
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses when the current password is wrong, and sends no mail", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);
    db.auth.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    const result = await requestEmailChange(PREV, emailChangeForm("new@example.com", "wrong"));

    expect(result.error).toMatch(/incorrect/i);
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("proceeds once the current password checks out", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);

    const result = await requestEmailChange(
      PREV,
      emailChangeForm("new@example.com", "correct-horse"),
    );

    expect(result.success).toBeTruthy();
    expect(db.auth.signInWithPassword).toHaveBeenCalledWith({
      email: USER.email,
      password: "correct-horse",
    });
    expect(db.auth.updateUser).toHaveBeenCalled();
  });

  it("does not demand a password from an account that genuinely has none", async () => {
    // Such an account has none to give; requiring one would lock them out of
    // a field they can still legitimately change.
    getUserMock.mockResolvedValue(OAUTH_USER);
    hasPasswordMock.mockResolvedValue(false);

    const result = await requestEmailChange(PREV, emailChangeForm());

    expect(result.success).toBeTruthy();
    expect(db.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("DEMANDS a password from an OAuth account that has one, despite `identities`", async () => {
    // The regression this whole change exists for. Setting a password through
    // the recovery flow writes the hash but creates no `email` identity, so the
    // old `identities.some(provider === "email")` check said "no password" and
    // this gate was skipped entirely. That made the chain: hijack a session ->
    // move the email with no proof -> reset the password to the new inbox.
    getUserMock.mockResolvedValue(OAUTH_USER); // identities says google only
    hasPasswordMock.mockResolvedValue(true); // the database says otherwise

    const result = await requestEmailChange(PREV, emailChangeForm());

    expect(result.error).toMatch(/current password/i);
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("fails CLOSED: an unreadable has-password answer still demands one", async () => {
    // accountHasPassword returns true on error for exactly this reason, but
    // assert it here too so the gate cannot be loosened by a broken lookup.
    getUserMock.mockResolvedValue(OAUTH_USER);
    hasPasswordMock.mockResolvedValue(true);

    const result = await requestEmailChange(PREV, emailChangeForm());

    expect(result.error).toMatch(/current password/i);
  });

  it("records the request so a silent address move leaves a trail", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);

    await requestEmailChange(PREV, emailChangeForm("new@example.com", "correct-horse"));

    expect(alertMock).toHaveBeenCalledWith(
      USER_ID,
      "email.change_requested",
      expect.objectContaining({ title: expect.any(String) }),
    );
  });

  it("rejects a smuggled extra field rather than ignoring it", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);
    const fd = emailChangeForm("new@example.com", "correct-horse");
    fd.append("is_seller", "true");

    const result = await requestEmailChange(PREV, fd);

    expect(result.error).toMatch(/is_seller/);
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("changePassword - oracle and session hardening", () => {
  function passwordForm() {
    const fd = new FormData();
    fd.append("current_password", "old-pass-word-1");
    fd.append("new_password", "new-pass-word-2");
    fd.append("confirm_password", "new-pass-word-2");
    return fd;
  }

  it("bounds re-auth attempts BEFORE checking the guess", async () => {
    // This endpoint verifies a caller-supplied password, so unbounded it is a
    // password oracle a hijacked session could grind against.
    getUserMock.mockResolvedValue(USER);
    rateLimitMock.mockResolvedValue(false);

    const result = await changePassword(PREV, passwordForm());

    expect(result.error).toMatch(/too many/i);
    expect(db.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(db.auth.updateUser).not.toHaveBeenCalled();
  });

  it("revokes other sessions after a successful change", async () => {
    // A password change made BECAUSE an account was compromised is pointless
    // if the intruder's existing session survives it.
    getUserMock.mockResolvedValue(USER);

    const result = await changePassword(PREV, passwordForm());

    expect(result.success).toBeTruthy();
    expect(db.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("keeps THIS session alive (scope 'others', never 'global')", async () => {
    getUserMock.mockResolvedValue(USER);
    await changePassword(PREV, passwordForm());
    const scopes = db.auth.signOut.mock.calls.map(
      ([opts]: [{ scope: string }]) => opts.scope,
    );
    expect(scopes).not.toContain("global");
    expect(scopes).not.toContain("local");
  });

  it("does not revoke anything when the change fails", async () => {
    getUserMock.mockResolvedValue(USER);
    db.auth.updateUser.mockResolvedValue({ error: { message: "nope" } });

    const result = await changePassword(PREV, passwordForm());

    expect(result.error).toBeTruthy();
    expect(db.auth.signOut).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// sendPasswordReset — the escape hatch, and the only way an account with no
// password gets one
// ==========================================================================

describe("sendPasswordReset - budgets", () => {
  it("mails the account's OWN address, never one from the form", async () => {
    // There is no email field by design. Assert the address comes from the
    // session, so nothing can aim this at a stranger's inbox.
    getUserMock.mockResolvedValue(PASSWORD_USER);

    const result = await sendPasswordReset(PREV, new FormData());

    expect(result.success).toBeTruthy();
    expect(db.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      USER.email,
      expect.objectContaining({ redirectTo: expect.stringContaining("/auth/callback") }),
    );
  });

  it("stops on the PER-USER budget", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);
    rateLimitMock.mockResolvedValue(false);

    const result = await sendPasswordReset(PREV, new FormData());

    expect(result.error).toMatch(/too many/i);
    expect(db.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("stops on the PER-CLIENT budget too", async () => {
    // Not redundant with the per-user one: that is spent per victim, so an
    // attacker holding several sessions gets a fresh allowance for each. This
    // caps what one origin can send in total.
    getUserMock.mockResolvedValue(PASSWORD_USER);
    rateLimitKeyMock.mockResolvedValue(false);

    const result = await sendPasswordReset(PREV, new FormData());

    expect(result.error).toMatch(/too many/i);
    expect(db.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("rejects a smuggled field rather than ignoring it", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);
    const fd = new FormData();
    fd.append("email", "attacker@example.com");

    const result = await sendPasswordReset(PREV, fd);

    expect(result.error).toMatch(/email/);
    expect(db.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("alerts the owner, which is the one alert that reaches them", async () => {
    // Requesting a link signs nobody out, so unlike a completed change this
    // notification actually lands somewhere the owner can still read it.
    getUserMock.mockResolvedValue(PASSWORD_USER);

    await sendPasswordReset(PREV, new FormData());

    expect(alertMock).toHaveBeenCalledWith(
      USER_ID,
      "password.reset_requested",
      expect.objectContaining({ title: expect.any(String) }),
    );
  });

  it("works for an account with no password, which is how it gets one", async () => {
    getUserMock.mockResolvedValue(OAUTH_USER);
    hasPasswordMock.mockResolvedValue(false);

    const result = await sendPasswordReset(PREV, new FormData());

    expect(result.success).toBeTruthy();
    expect(db.auth.resetPasswordForEmail).toHaveBeenCalled();
  });
});

describe("changePassword - audit", () => {
  it("records the change and notifies after the password is already set", async () => {
    getUserMock.mockResolvedValue(PASSWORD_USER);
    const fd = new FormData();
    fd.append("current_password", "old-Password-1");
    fd.append("new_password", "Kettle-Boat-99");
    fd.append("confirm_password", "Kettle-Boat-99");

    const result = await changePassword(PREV, fd);

    expect(result.success).toBeTruthy();
    expect(alertMock).toHaveBeenCalledWith(
      USER_ID,
      "password.changed",
      expect.objectContaining({ title: expect.any(String) }),
    );
  });

  it("a failing audit write never fails the password change", async () => {
    // The log is best-effort by contract. Turning a completed credential
    // change into an error the user retries would be worse than a missing row.
    getUserMock.mockResolvedValue(PASSWORD_USER);
    alertMock.mockRejectedValue(new Error("audit down"));
    const fd = new FormData();
    fd.append("current_password", "old-Password-1");
    fd.append("new_password", "Kettle-Boat-99");
    fd.append("confirm_password", "Kettle-Boat-99");

    await expect(changePassword(PREV, fd)).resolves.toEqual(
      expect.objectContaining({ success: expect.any(String) }),
    );
  });
});
