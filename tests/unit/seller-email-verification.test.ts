// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Double opt-in for the seller's buyer-facing contact address: the last layer
// of the publish gate, and the only one that proves a mailbox is read rather
// than merely well-formed.

type SentMessage = { to: string; subject: string; text: string };
const sendEmail = vi.fn(
  async (_message: SentMessage) => ({ sent: true }) as { sent: boolean; reason?: string },
);
const emailSendingEnabled = vi.fn(() => true);
vi.mock("@/lib/email/send", () => ({
  sendEmail: (message: SentMessage) => sendEmail(message),
  emailSendingEnabled: () => emailSendingEnabled(),
}));

/** Rows the fake admin client answers with, per table. */
type Row = Record<string, unknown> | null;
const state: {
  verification: Row;
  profile: Row;
  claimed: Row;
  inserted: Record<string, unknown> | null;
  deletedFor: string | null;
  profileUpdate: Record<string, unknown> | null;
  profileUpdateFilters: [string, unknown][];
} = {
  verification: null,
  profile: null,
  claimed: { id: "row-1" },
  inserted: null,
  deletedFor: null,
  profileUpdate: null,
  profileUpdateFilters: [],
};

function builder(table: string) {
  let mode: "select" | "insert" | "update" | "delete" = "select";
  const chain = {
    select: () => chain,
    insert: (values: Record<string, unknown>) => {
      mode = "insert";
      state.inserted = values;
      return { error: null };
    },
    update: (values: Record<string, unknown>) => {
      mode = "update";
      if (table === "profiles") state.profileUpdate = values;
      return chain;
    },
    delete: () => {
      mode = "delete";
      return chain;
    },
    eq: (column: string, value: unknown) => {
      if (table === "profiles" && mode === "update") {
        state.profileUpdateFilters.push([column, value]);
      }
      if (table === "seller_email_verifications" && mode === "delete") {
        state.deletedFor = String(value);
      }
      return chain;
    },
    is: () => chain,
    maybeSingle: async () => {
      if (table === "profiles") return { data: state.profile, error: null };
      if (mode === "update") return { data: state.claimed, error: null };
      return { data: state.verification, error: null };
    },
    // The delete is awaited directly, with no terminal method.
    then: (resolve: (v: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));

const {
  consumeSellerEmailVerification,
  hashToken,
  sellerEmailVerificationRequired,
  startSellerEmailVerification,
  VERIFY_PATH,
} = await import("@/lib/settings/seller-email-verification");

const OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EMAIL = "hello@studio-builderboy.at";
const ORIGIN = "https://dashboard.squareshare.eu";

/** A future timestamp, for a token that has not expired. */
const LATER = () => new Date(Date.now() + 60_000).toISOString();
const EARLIER = () => new Date(Date.now() - 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  emailSendingEnabled.mockReturnValue(true);
  sendEmail.mockResolvedValue({ sent: true });
  state.verification = null;
  state.profile = null;
  state.claimed = { id: "row-1" };
  state.inserted = null;
  state.deletedFor = null;
  state.profileUpdate = null;
  state.profileUpdateFilters = [];
});

describe("sellerEmailVerificationRequired", () => {
  it("follows whether the platform can send mail at all", () => {
    expect(sellerEmailVerificationRequired()).toBe(true);
    emailSendingEnabled.mockReturnValue(false);
    expect(sellerEmailVerificationRequired()).toBe(false);
  });
});

describe("startSellerEmailVerification", () => {
  it("stores only the HASH of the token, never the token", async () => {
    const result = await startSellerEmailVerification(OWNER, EMAIL, ORIGIN);
    expect(result).toEqual({ ok: true, sent: true });

    const stored = state.inserted!;
    // A SHA-256 digest and nothing else — the same shape the table's CHECK
    // constraint enforces.
    expect(String(stored.token_hash)).toMatch(/^[0-9a-f]{64}$/);

    // The raw token is in the link, and the stored hash is its digest. If
    // these ever matched, the table would be holding a live credential.
    const link = sendEmail.mock.calls[0]![0].text;
    const token = link.match(/token=([0-9a-f]{64})/)![1];
    expect(token).not.toBe(stored.token_hash);
    expect(await hashToken(token)).toBe(stored.token_hash);
  });

  it("sends the link to the address being proven, and nowhere else", async () => {
    await startSellerEmailVerification(OWNER, EMAIL, ORIGIN);
    const message = sendEmail.mock.calls[0]![0];
    expect(message.to).toBe(EMAIL);
    expect(message.text).toContain(`${ORIGIN}${VERIFY_PATH}?token=`);
  });

  it("invalidates this account's outstanding links first", async () => {
    // A seller who mistypes and corrects must not leave a working link to the
    // wrong address behind.
    await startSellerEmailVerification(OWNER, EMAIL, ORIGIN);
    expect(state.deletedFor).toBe(OWNER);
  });

  it("does nothing at all when verification is switched off", async () => {
    emailSendingEnabled.mockReturnValue(false);
    const result = await startSellerEmailVerification(OWNER, EMAIL, ORIGIN);
    expect(result).toEqual({ ok: true, sent: false });
    expect(state.inserted).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports a failed send rather than claiming the link went out", async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: "failed" });
    const result = await startSellerEmailVerification(OWNER, EMAIL, ORIGIN);
    expect(result.ok).toBe(false);
  });
});

describe("consumeSellerEmailVerification", () => {
  const TOKEN = "a".repeat(64);

  it("refuses a token that is not 64 hex characters, without any I/O", async () => {
    for (const bad of ["", "nope", "A".repeat(64), "a".repeat(63)]) {
      expect(await consumeSellerEmailVerification(bad)).toEqual({ status: "invalid" });
    }
  });

  it("marks the profile verified for a good token", async () => {
    state.verification = {
      id: "row-1",
      owner_id: OWNER,
      email: EMAIL,
      expires_at: LATER(),
      consumed_at: null,
    };
    state.profile = { seller_email: EMAIL };

    const outcome = await consumeSellerEmailVerification(TOKEN);

    expect(outcome).toEqual({ status: "verified", email: EMAIL });
    expect(state.profileUpdate).toEqual({
      seller_email_verified_at: expect.any(String),
    });
    // The write is scoped to the owner AND to the exact address the token was
    // issued for, so a change between read and write cannot verify the wrong
    // one.
    expect(state.profileUpdateFilters).toEqual(
      expect.arrayContaining([
        ["id", OWNER],
        ["seller_email", EMAIL],
      ]),
    );
  });

  it("refuses an expired link, and says so", async () => {
    state.verification = {
      id: "row-1",
      owner_id: OWNER,
      email: EMAIL,
      expires_at: EARLIER(),
      consumed_at: null,
    };
    state.profile = { seller_email: EMAIL };
    expect(await consumeSellerEmailVerification(TOKEN)).toEqual({ status: "expired" });
  });

  it("refuses a link for an address the seller has since changed", async () => {
    // Otherwise a@x's link would confirm b@y — proof of the wrong mailbox.
    state.verification = {
      id: "row-1",
      owner_id: OWNER,
      email: "old@studio-builderboy.at",
      expires_at: LATER(),
      consumed_at: null,
    };
    state.profile = { seller_email: EMAIL };
    expect(await consumeSellerEmailVerification(TOKEN)).toEqual({ status: "stale" });
    expect(state.profileUpdate).toBeNull();
  });

  it("treats an already-used link as simply invalid", async () => {
    // Same answer as an unknown token: someone holding one they were not sent
    // learns nothing from the difference.
    state.verification = {
      id: "row-1",
      owner_id: OWNER,
      email: EMAIL,
      expires_at: LATER(),
      consumed_at: new Date().toISOString(),
    };
    expect(await consumeSellerEmailVerification(TOKEN)).toEqual({ status: "invalid" });
  });

  it("loses the race gracefully when another click claims the token first", async () => {
    state.verification = {
      id: "row-1",
      owner_id: OWNER,
      email: EMAIL,
      expires_at: LATER(),
      consumed_at: null,
    };
    state.profile = { seller_email: EMAIL };
    // The claiming UPDATE matches no row: someone else got there.
    state.claimed = null;
    expect(await consumeSellerEmailVerification(TOKEN)).toEqual({ status: "invalid" });
    expect(state.profileUpdate).toBeNull();
  });
});
