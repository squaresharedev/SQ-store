import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification, notificationInEnglish } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import type { NotificationMessageRef } from "@/lib/notifications/message";
import { clientKey } from "@/lib/rate-limit";
import type { MessageKey } from "@/i18n/types";
import type { Json } from "@/types";

/**
 * The ONE place a credential-level event is recorded. Server-side only
 * (service_role), because `security_events` carries a SELECT policy for the
 * owner and nothing else: there is no insert path for any client, by design.
 * An audit log the suspect can write to is worse than no audit log.
 *
 * Best-effort by contract, exactly like createNotification: returns false on
 * failure and NEVER throws. Recording that a password changed must not be able
 * to fail the password change itself, so every call site fires this after the
 * credential work is already done and ignores the result.
 */

/**
 * The closed vocabulary. The column's CHECK constrains the SHAPE of a slug;
 * this list is what the app actually emits, so a typo is a type error rather
 * than a new event kind nobody is looking for.
 */
export const SECURITY_EVENTS = [
  /** Changed from settings, with the old password supplied. */
  "password.changed",
  /** Set through a recovery link, including an OAuth account's first one. */
  "password.set",
  /** A reset link was mailed to the account's own address. */
  "password.reset_requested",
  /** A move to a new address was requested (not yet confirmed). */
  "email.change_requested",
  /** Two-factor authentication turned on (first authenticator verified). */
  "mfa.enabled",
  /** Two-factor authentication turned off (last authenticator removed). */
  "mfa.disabled",
  /** Another authenticator added while 2FA was already on. */
  "mfa.factor_added",
  /** One authenticator removed while others remain. */
  "mfa.factor_removed",
  /** A fresh set of recovery codes replaced the old one. */
  "mfa.recovery_codes_regenerated",
  /** A recovery code was spent to sign in, which also turns 2FA off. */
  "mfa.recovery_code_used",
  /** A wrong code at the sign-in challenge: the password was RIGHT. */
  "mfa.challenge_failed",
  /** Too many wrong codes; further attempts refused for a while. */
  "mfa.locked_out",
] as const;

export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

/**
 * How each event reads in the account's own activity list (Settings ›
 * Security): the message key for each, resolved where the list renders. Past
 * tense, plain language, no jargon beyond "two-factor".
 */
export const SECURITY_EVENT_LABELS: Record<SecurityEvent, MessageKey> = {
  "password.changed": "Settings.security.activity.events.passwordChanged",
  "password.set": "Settings.security.activity.events.passwordSet",
  "password.reset_requested": "Settings.security.activity.events.passwordResetRequested",
  "email.change_requested": "Settings.security.activity.events.emailChangeRequested",
  "mfa.enabled": "Settings.security.activity.events.twoFactorEnabled",
  "mfa.disabled": "Settings.security.activity.events.twoFactorDisabled",
  "mfa.factor_added": "Settings.security.activity.events.factorAdded",
  "mfa.factor_removed": "Settings.security.activity.events.factorRemoved",
  "mfa.recovery_codes_regenerated": "Settings.security.activity.events.recoveryCodesRegenerated",
  "mfa.recovery_code_used": "Settings.security.activity.events.recoveryCodeUsed",
  "mfa.challenge_failed": "Settings.security.activity.events.challengeFailed",
  "mfa.locked_out": "Settings.security.activity.events.lockedOut",
};

export function isSecurityEvent(value: unknown): value is SecurityEvent {
  return (
    typeof value === "string" &&
    (SECURITY_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * SHA-256 of the caller's IP. Hashed rather than stored, for the same reason
 * the rate limiter hashes its keys: equality is all this needs, and an audit
 * table that quietly becomes a record of where someone lives is a liability
 * rather than a security control.
 */
async function hashedClientIp(): Promise<string | null> {
  try {
    const raw = await clientKey(await headers());
    if (!raw || raw === "unknown-client") return null;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw),
    );
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // A missing request context is not a reason to lose the event.
    return null;
  }
}

export async function recordSecurityEvent(input: {
  userId: string;
  event: SecurityEvent;
  /** Small, non-secret context. NEVER a password, token or raw IP. */
  meta?: Record<string, string | number | boolean | null>;
}): Promise<boolean> {
  const { userId, event, meta } = input;
  if (!userId || !SECURITY_EVENTS.includes(event)) {
    console.error("[security] refused to record invalid event:", event);
    return false;
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("security_events").insert({
      user_id: userId,
      event,
      ip_hash: await hashedClientIp(),
      meta: (meta ?? {}) as Json,
    });
    if (error) {
      console.error("[security] event insert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "[security] recordSecurityEvent threw:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Record a credential event AND tell the account holder about it.
 *
 * Call this after the credential work has already succeeded, and ignore the
 * result: neither the log nor the bell may turn a completed password change
 * into an error the user might retry. `allSettled` so one failing does not
 * take the other with it.
 *
 * The bell alone is a weak channel for a credential alert: someone who changes
 * a password and revokes sessions locks the owner out before they can read it.
 * Pass `emailTo` for the events where that matters (the 2FA ones do); the
 * email goes through the transactional mailer, which is off in production
 * until Cloudflare Email Service is configured, so until then the bell and the
 * activity log are what the owner has.
 */
export type SecurityNotice = {
  /** Keys, like every notification: the bell resolves them for the reader. */
  title: NotificationMessageRef;
  body: NotificationMessageRef;
  /** Where the bell entry links. Defaults to the password card. */
  href?: string;
  /**
   * Also email this to the account's address. For the events where the
   * in-app bell is the WRONG channel: if an intruder just turned 2FA off,
   * the owner may never see the dashboard again, but they will see their
   * inbox. Goes through lib/email/send.ts, so it is off until Cloudflare
   * Email Service is configured, and lands in the dev outbox locally.
   */
  emailTo?: string | null;
};

export async function alertSecurityEvent(
  userId: string,
  event: SecurityEvent,
  notify: SecurityNotice,
): Promise<void> {
  try {
    await Promise.allSettled([
      recordSecurityEvent({ userId, event }),
      createNotification({
        userId,
        type: "security",
        message: { title: notify.title, body: notify.body },
        data: { href: notify.href ?? "/settings/account#password" },
      }),
      notify.emailTo ? emailSecurityNotice(notify.emailTo, notify) : Promise.resolve(),
    ]);
  } catch (err) {
    // allSettled already absorbs rejections from the two calls; this catches
    // anything thrown before them (a missing request context, a failed admin
    // client construction). The guarantee is what call sites rely on.
    console.error(
      "[security] alertSecurityEvent threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * The out-of-band half of an alert. Plain text only: this is the message a
 * person reads when something may be wrong with their account, and it must
 * work in any mail client. The link is built from NEXT_PUBLIC_APP_URL rather
 * than the request's Host header, so a forged Host cannot point it elsewhere.
 * Never throws (sendEmail only throws on a deployment misconfiguration, which
 * is caught here so the credential change that triggered it still stands).
 *
 * In English, like the bell row's stored title and body: the mailer has no
 * localised templates yet.
 */
async function emailSecurityNotice(to: string, notify: SecurityNotice): Promise<void> {
  try {
    const notice = {
      title: notificationInEnglish(notify.title),
      body: notificationInEnglish(notify.body),
      href: notify.href,
    };
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
      /\/+$/,
      "",
    );
    const link = `${origin}${notice.href ?? "/settings/security"}`;
    const result = await sendEmail({
      to,
      subject: `Security alert: ${notice.title}`,
      text: [
        notice.body,
        "",
        `Review your account security: ${link}`,
        "",
        "If this was you, there is nothing else to do.",
        "If it wasn't, change your password straight away and turn on two-factor authentication.",
        "",
        "Square Share",
      ].join("\n"),
    });
    if (!result.sent && result.reason === "failed") {
      console.error("[security] alert email failed:", result.detail);
    }
  } catch (err) {
    console.error(
      "[security] alert email threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
