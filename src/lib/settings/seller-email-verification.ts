// SERVER ONLY. Double opt-in for the seller's buyer-facing contact address.
//
// WHY THIS EXISTS. Every other check on `seller_email` tests the address's
// SHAPE: it parses (lib/validation/inputs.ts), it is not a placeholder or a
// throwaway inbox (email-quality.ts), and its domain accepts mail at all
// (email-domain.ts). Not one of those proves a mailbox exists or that the
// seller reads it — and that address is the only route a buyer has to the
// trader they are contracting with. Sending a link and seeing it clicked is
// the one check that settles it, so this is the last layer of the publish
// gate rather than a nice-to-have on top of it.
//
// THE SHAPE OF A TOKEN. 32 random bytes, hex, generated with the platform CSPRNG.
// Only its SHA-256 hash is stored (20260909_seller_email_verification), so a
// dump of the table hands an attacker nothing usable — the same reasoning that
// keeps password hashes out of plaintext. Verification is by hash lookup, and
// a token is single-use: `consumed_at` is stamped in the same UPDATE that
// claims it, so two clicks on the same link cannot both succeed.
//
// SCOPE OF A TOKEN. It proves ONE address for ONE account. The row carries the
// email it was sent to, and consuming it only verifies the profile if that
// address is still the profile's current `seller_email` — otherwise a seller
// who typed a@x, then corrected to b@y, could click the stale a@x link and
// have b@y marked verified.
//
// OFF WHEN MAIL IS OFF. If this deployment cannot send (see
// lib/email/send.ts — the Cloudflare Email Service binding is not configured
// yet), {@link sellerEmailVerificationRequired} is false and the publish gate
// falls back to requiring the address to be PRESENT, as it did before. A gate
// that demands a click on a link nobody can send is not a stricter gate, it is
// a locked door with no key.

import { createAdminClient } from "@/lib/supabase/admin";
import { emailSendingEnabled, sendEmail } from "@/lib/email/send";

/** How long a link is good for. Long enough to find the mail tomorrow. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Where a link lands. A GET route, because it is clicked from a mail client. */
export const VERIFY_PATH = "/settings/verify-seller-email";

/**
 * Is a VERIFIED contact address required to publish, or only a present one?
 *
 * False whenever the platform cannot send mail. See the header.
 */
export function sellerEmailVerificationRequired(): boolean {
  return emailSendingEnabled();
}

/** 32 random bytes as hex. */
function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256, hex. Web Crypto rather than node:crypto because this runs on
 * Workers; the digest is what the table's CHECK constraint expects.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** The message a seller receives. Plain text carries the whole thing. */
function verificationEmail(link: string, email: string) {
  return {
    to: email,
    subject: "Confirm your Squareshare contact email",
    text: [
      "Confirm this address so buyers can reach you.",
      "",
      "You (or someone using your Squareshare account) set this address as the",
      "contact email shown on your product pages. Until it is confirmed, you",
      "cannot put products on sale or embed a storefront.",
      "",
      "Confirm it here:",
      link,
      "",
      "The link is good for 24 hours and can be used once.",
      "",
      "If this was not you, ignore this email. Nothing is shown to buyers and",
      "nothing changes on your account until the link is used.",
      "",
      "— Squareshare",
    ].join("\n"),
  };
}

/**
 * Why a link did not go out. A code rather than a sentence: the settings
 * action words it for the reader (Errors.settings.confirmationFailed).
 */
export type VerificationFailureReason = "startFailed" | "unavailable" | "sendFailed";

export type VerificationStartResult =
  | { ok: true; sent: boolean }
  | { ok: false; reason: VerificationFailureReason };

/**
 * Issue a link for `email` and send it.
 *
 * Outstanding links for this account are invalidated first: a seller who
 * corrects a typo should not leave a working link to the wrong address behind,
 * and it keeps at most one live token per account so a resend loop cannot
 * accumulate credentials.
 *
 * `sent: false` with `ok: true` means verification is switched off for this
 * deployment — the caller has nothing to report to the seller, because nothing
 * was promised.
 */
export async function startSellerEmailVerification(
  ownerId: string,
  email: string,
  origin: string,
): Promise<VerificationStartResult> {
  if (!sellerEmailVerificationRequired()) return { ok: true, sent: false };

  const token = mintToken();
  const tokenHash = await hashToken(token);
  const admin = createAdminClient();

  const { error: clearError } = await admin
    .from("seller_email_verifications")
    .delete()
    .eq("owner_id", ownerId)
    .is("consumed_at", null);
  if (clearError) {
    console.error("[seller-email] could not clear old tokens", clearError.message);
    return { ok: false, reason: "startFailed" };
  }

  const { error } = await admin.from("seller_email_verifications").insert({
    owner_id: ownerId,
    email,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[seller-email] could not store token", error.message);
    return { ok: false, reason: "startFailed" };
  }

  // The RAW token only ever exists in this function and in the link.
  const link = `${origin}${VERIFY_PATH}?token=${token}`;
  const result = await sendEmail(verificationEmail(link, email));
  if (!result.sent) {
    return {
      ok: false,
      reason: result.reason === "disabled" ? "unavailable" : "sendFailed",
    };
  }
  return { ok: true, sent: true };
}

export type VerificationOutcome =
  | { status: "verified"; email: string }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "stale" };

/**
 * Claim a token and mark the address verified.
 *
 * Every failure mode is distinguished for the SELLER's benefit — "that link
 * expired" and "that link is for an address you have since changed" call for
 * different next steps — but none of them reveals anything to someone holding
 * a token they were not sent: an unknown hash and a consumed one are both
 * `invalid`, which is what a guesser would get either way.
 */
export async function consumeSellerEmailVerification(
  token: string,
): Promise<VerificationOutcome> {
  // Shape-check before any I/O: a token is 64 hex characters and nothing else,
  // so garbage in a URL costs a regex rather than a query.
  if (!/^[0-9a-f]{64}$/.test(token)) return { status: "invalid" };

  const tokenHash = await hashToken(token);
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("seller_email_verifications")
    .select("id, owner_id, email, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    console.error("[seller-email] token read failed", error.message);
    return { status: "invalid" };
  }
  if (!row || row.consumed_at) return { status: "invalid" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: "expired" };

  // The address must still be the one the profile is offering to buyers.
  const { data: profile } = await admin
    .from("profiles")
    .select("seller_email")
    .eq("id", row.owner_id)
    .maybeSingle();
  if (!profile || profile.seller_email !== row.email) return { status: "stale" };

  // Claim it. `is("consumed_at", null)` makes this the race winner check as
  // well as the update: a second click finds nothing to claim.
  const { data: claimed, error: claimError } = await admin
    .from("seller_email_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) return { status: "invalid" };

  const { error: markError } = await admin
    .from("profiles")
    .update({ seller_email_verified_at: new Date().toISOString() })
    .eq("id", row.owner_id)
    // Re-checked at the write, so a change between the read above and here
    // cannot mark the wrong address verified.
    .eq("seller_email", row.email);
  if (markError) {
    console.error("[seller-email] could not mark verified", markError.message);
    return { status: "invalid" };
  }

  return { status: "verified", email: row.email };
}
