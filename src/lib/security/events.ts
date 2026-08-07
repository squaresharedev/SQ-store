import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { clientKey } from "@/lib/rate-limit";
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
] as const;

export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

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
 * Honest about what this is: the notification is IN-APP ONLY, because no
 * transactional email provider is wired up yet. Someone who changes a password
 * and revokes sessions locks the owner out before they can read it. Where it
 * earns its keep is the reset-requested case (nobody is signed out, so the
 * owner can act) and as a record to review after regaining access.
 */
export async function alertSecurityEvent(
  userId: string,
  event: SecurityEvent,
  notify: { title: string; body: string },
): Promise<void> {
  try {
    await Promise.allSettled([
      recordSecurityEvent({ userId, event }),
      createNotification({
        userId,
        type: "security",
        title: notify.title,
        body: notify.body,
        data: { href: "/settings/account#password" },
      }),
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
