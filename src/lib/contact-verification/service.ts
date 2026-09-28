// SERVER ONLY. Proving a seller owns the contact details buyers are shown:
// issue a code to the stored email or phone, and check the one typed back.
//
// THE GUARANTEES, and where each one lives:
//
//   * The recipient is never chosen by a request. It is read from the stored
//     profile, re-validated here (a value written around the settings form
//     gets no easier ride), and bound to the code by the database, which hands
//     back the only address the code may be sent to.
//   * A code proves ONE value for ONE account. Its HMAC includes both
//     (./code.ts), and redemption only proves the profile if it still holds
//     the exact value the code went to (redeem_contact_verification).
//   * Guessing is bounded three ways: CONTACT_CODE_MAX_ATTEMPTS per code,
//     counted inside the same locked SQL call that checks it; a per-account
//     budget on checks; and a per-TARGET budget on codes that no number of new
//     accounts resets.
//   * Sending is bounded five ways (see the contact* budgets in
//     lib/rate-limit.ts), and texts only go to SMS_REGIONS.
//   * The proof itself can only be written by the service role, and is dropped
//     whenever the value changes, by a trigger no client can route around
//     (guard_contact_proof).
//
// Every function takes the ACCOUNT id, and callers must pass the signed-in
// user's own id: Settings is scoped to the session, and a team member can
// never prove (or ask for codes to) the owner's contact details.

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { sendSms } from "@/lib/sms/send";
import { actionError, invalidInput, type ActionError } from "@/lib/errors";
import { msg } from "@/i18n/types";
import { emailAddress } from "@/lib/validation/inputs";
import { emailQualityProblem } from "@/lib/validation/email-quality";
import { formatPhoneInternational, normalizeSellerPhone } from "@/lib/validation/phone";
import {
  contactChannelAvailable,
  emailProofRequired,
} from "@/lib/contact-verification/availability";
import {
  formatContactCode,
  hashContactCode,
  mintContactCode,
} from "@/lib/contact-verification/code";
import {
  CONTACT_CHANNELS,
  CONTACT_CODE_MAX_ATTEMPTS,
  CONTACT_CODE_TTL_SECONDS,
  type ContactChannel,
} from "@/lib/contact-verification/policy";

export type IssueResult =
  | { ok: true; status: "sent"; target: string }
  | { ok: true; status: "alreadyConfirmed" }
  | { ok: false; error: ActionError };

export type RedeemResult = { ok: true } | { ok: false; error: ActionError };

const refuse = (error: ActionError) => ({ ok: false as const, error });

// ── The refusals, worded once ──────────────────────────────────────────────

const unavailable = (channel: ContactChannel) =>
  actionError("server_error", msg("Errors.contactVerification.unavailable", { channel }));
const nothingToConfirm = (channel: ContactChannel) =>
  invalidInput(msg("Errors.contactVerification.nothingToConfirm", { channel }));
const sendFailed = (channel: ContactChannel) =>
  actionError("server_error", msg("Errors.contactVerification.sendFailed", { channel }));
const COOLDOWN = actionError("rate_limited", msg("Errors.contactVerification.cooldown"));
const TOO_MANY_CODES = actionError("rate_limited", msg("Errors.contactVerification.tooManyCodes"));
const TOO_MANY_ATTEMPTS = actionError(
  "rate_limited",
  msg("Errors.contactVerification.tooManyAttempts"),
);
const CHECK_FAILED = actionError("server_error", msg("Errors.contactVerification.failed"));
const STALE = invalidInput(msg("Errors.contactVerification.stale"));

/** What each answer from redeem_contact_verification means to the seller. */
const REDEEM_REFUSALS: Record<string, ActionError> = {
  mismatch: invalidInput(msg("Errors.contactVerification.wrongCode")),
  locked: invalidInput(msg("Errors.contactVerification.locked")),
  expired: invalidInput(msg("Errors.contactVerification.expired")),
  none: invalidInput(msg("Errors.contactVerification.noCode")),
  stale: STALE,
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** The profile columns each channel is stored in, value and proof. */
const PROFILE_CONTACT_SELECT =
  "seller_email, seller_email_verified_at, seller_phone, seller_phone_verified_at" as const;

/**
 * Would the settings form accept this stored value today? A value that reached
 * the row some other way (a direct REST write, a pre-normalisation phone) must
 * not be proven into something the form refuses: a throwaway inbox the seller
 * really does read is still a throwaway inbox, and a premium-rate number is
 * exactly what SMS pumping wants texted.
 */
function storedValueProblem(channel: ContactChannel, value: string): ActionError | null {
  if (channel === "email") {
    if (!emailAddress("contactEmail").safeParse(value).success) {
      return invalidInput(msg("Validation.email.contactEmail.format"));
    }
    const problem = emailQualityProblem(value);
    return problem ? invalidInput(msg(problem)) : null;
  }
  const phone = normalizeSellerPhone(value);
  if (phone.ok && phone.e164 === value) return null;
  // Saved before numbers were normalised: the fix is to save it again.
  if (phone.ok || !value.startsWith("+")) {
    return invalidInput(msg("Errors.contactVerification.phoneNeedsResave"));
  }
  return invalidInput(msg(phone.problem));
}

/** How a recipient is named back to the seller. */
function displayTarget(channel: ContactChannel, target: string): string {
  return channel === "phone" ? formatPhoneInternational(target) : target;
}

/** Word and send the code, in the language the seller is using right now. */
async function deliverCode(
  channel: ContactChannel,
  target: string,
  code: string,
): Promise<SendResult> {
  const t = await getTranslations("Settings.contactVerification.message");
  const minutes = CONTACT_CODE_TTL_SECONDS / 60;
  if (channel === "email") {
    const shown = formatContactCode(code);
    return sendEmail({
      to: target,
      subject: t("emailSubject", { code: shown }),
      text: t("emailBody", { code: shown, minutes }),
    });
  }
  // Unspaced in a text: phones offer a bare digit run for one-tap autofill.
  return sendSms({ to: target, text: t("sms", { code, minutes }) });
}

// ── Issue ──────────────────────────────────────────────────────────────────

/**
 * Send a fresh code to this account's stored value for `channel`, replacing
 * any earlier one.
 *
 * Budgets are spent cheapest-first and OWN-first: the account's cooldown and
 * hourly/daily budgets before the profile is even read, then the budgets that
 * protect other people (the target's, the client's, the platform's SMS bill)
 * once the recipient is known. Nothing is sent until all have passed.
 */
export async function issueContactCode(
  ownerId: string,
  channel: ContactChannel,
): Promise<IssueResult> {
  if (!contactChannelAvailable(channel)) {
    if (channel === "email" && emailProofRequired()) {
      // Proof is demanded but cannot be given, so nobody can publish. Loud on
      // purpose: see availability.ts for why this does not quietly switch the
      // requirement off instead.
      console.error(
        "[contact-verification] email proof is required but no code can be issued: CONTACT_VERIFICATION_KEY is missing or not 32 bytes",
      );
    }
    return refuse(unavailable(channel));
  }

  if (!(await rateLimit(`contact_code_cooldown_${channel}`, RATE_LIMITS.contactCodeCooldown))) {
    return refuse(COOLDOWN);
  }
  if (
    !(await rateLimit("contact_code_send", RATE_LIMITS.contactCodeSend)) ||
    !(await rateLimit("contact_code_send_daily", RATE_LIMITS.contactCodeSendDaily))
  ) {
    return refuse(TOO_MANY_CODES);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error(
      "[contact-verification] admin client unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return refuse(unavailable(channel));
  }

  const { data: profile, error: readError } = await admin
    .from("profiles")
    .select(PROFILE_CONTACT_SELECT)
    .eq("id", ownerId)
    .maybeSingle();
  if (readError) {
    console.error("[contact-verification] profile read failed:", readError.code, readError.message);
    return refuse(unavailable(channel));
  }
  const value = channel === "email" ? profile?.seller_email : profile?.seller_phone;
  const proven =
    channel === "email" ? profile?.seller_email_verified_at : profile?.seller_phone_verified_at;
  if (!value) return refuse(nothingToConfirm(channel));
  if (proven) return { ok: true, status: "alreadyConfirmed" };

  const problem = storedValueProblem(channel, value);
  if (problem) return refuse(problem);

  // The budgets no new sign-up resets.
  if (
    !(await rateLimitKey(
      `${channel}:${value.toLowerCase()}`,
      "contact_code_target",
      RATE_LIMITS.contactCodePerTarget,
    ))
  ) {
    return refuse(TOO_MANY_CODES);
  }
  if (
    !(await rateLimitKey(
      await clientKey(await headers()),
      "contact_code_client",
      RATE_LIMITS.contactCodePerClient,
    ))
  ) {
    return refuse(TOO_MANY_CODES);
  }
  if (
    channel === "phone" &&
    !(await rateLimitKey("platform", "contact_sms_platform", RATE_LIMITS.contactSmsPlatformDaily))
  ) {
    console.error("[contact-verification] the platform's daily SMS ceiling is spent");
    return refuse(unavailable(channel));
  }

  const code = mintContactCode();
  const codeHash = await hashContactCode(ownerId, channel, code);
  if (!codeHash) return refuse(unavailable(channel));

  const { data: target, error: issueError } = await admin.rpc("issue_contact_verification", {
    p_owner: ownerId,
    p_channel: channel,
    p_code_hash: codeHash,
    p_ttl_seconds: CONTACT_CODE_TTL_SECONDS,
  });
  if (issueError) {
    console.error("[contact-verification] issue failed:", issueError.code, issueError.message);
    return refuse(unavailable(channel));
  }
  // Proven or cleared between the read above and the issue: nothing to send.
  if (!target) return { ok: true, status: "alreadyConfirmed" };
  // Changed between the two: the budgets above were spent on another value.
  if (target !== value) return refuse(STALE);

  // The RAW code exists only here and in the message. Never logged.
  let sent: SendResult;
  try {
    sent = await deliverCode(channel, target, code);
  } catch (err) {
    // A misconfigured transport (enabled, no API key). Logged loudly by name,
    // answered to the seller as "not available" rather than as a crash.
    console.error(
      `[contact-verification] ${channel} transport misconfigured:`,
      err instanceof Error ? err.message : String(err),
    );
    return refuse(unavailable(channel));
  }
  if (!sent.sent) {
    return refuse(sent.reason === "disabled" ? unavailable(channel) : sendFailed(channel));
  }
  return { ok: true, status: "sent", target: displayTarget(channel, target) };
}

// ── Redeem ─────────────────────────────────────────────────────────────────

/** Check a typed code and, if it is right, prove the value it was sent to. */
export async function redeemContactCode(
  ownerId: string,
  channel: ContactChannel,
  code: string,
): Promise<RedeemResult> {
  if (!(await rateLimit("contact_code_verify", RATE_LIMITS.contactCodeVerify))) {
    return refuse(TOO_MANY_ATTEMPTS);
  }

  const codeHash = await hashContactCode(ownerId, channel, code);
  if (!codeHash) return refuse(unavailable(channel));

  try {
    const { data: outcome, error } = await createAdminClient().rpc(
      "redeem_contact_verification",
      {
        p_owner: ownerId,
        p_channel: channel,
        p_code_hash: codeHash,
        p_max_attempts: CONTACT_CODE_MAX_ATTEMPTS,
      },
    );
    if (error) {
      console.error("[contact-verification] redeem failed:", error.code, error.message);
      return refuse(CHECK_FAILED);
    }
    if (outcome === "verified") return { ok: true };
    return refuse(REDEEM_REFUSALS[outcome ?? ""] ?? CHECK_FAILED);
  } catch (err) {
    console.error(
      "[contact-verification] redeem threw:",
      err instanceof Error ? err.message : String(err),
    );
    return refuse(CHECK_FAILED);
  }
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Which channels have a live code waiting to be typed, so the settings page
 * reopens on the code box after a reload instead of offering to send another.
 * A read failure answers "none": the worst case is an extra "Send code" click.
 */
export async function pendingContactCodes(
  ownerId: string,
): Promise<Record<ContactChannel, boolean>> {
  const none = { email: false, phone: false };
  try {
    const { data, error } = await createAdminClient()
      .from("contact_verifications")
      .select("channel, expires_at, attempts")
      .eq("owner_id", ownerId)
      .is("consumed_at", null);
    if (error || !data) return none;
    const now = Date.now();
    const live = (channel: ContactChannel) =>
      data.some(
        (row) =>
          row.channel === channel &&
          row.attempts < CONTACT_CODE_MAX_ATTEMPTS &&
          new Date(row.expires_at).getTime() > now,
      );
    return Object.fromEntries(CONTACT_CHANNELS.map((c) => [c, live(c)])) as Record<
      ContactChannel,
      boolean
    >;
  } catch {
    return none;
  }
}
