import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// SERVER ONLY. rateLimitKey uses the service-role admin client; this module must
// never be imported from a Client Component. (Enforced by convention here — the
// `server-only` package is not a dependency of this project.)

/**
 * Server-side rate limiting. Both helpers are backed by an EXACT SLIDING WINDOW
 * in Postgres (see supabase/migrations/20260721_sliding_window_rate_limits.sql),
 * so a caller cannot spend a full budget just before a boundary and another one
 * just after — every take counts the hits in the PRECEDING window, continuously.
 *
 * Postgres (not memory) is the right home for this on Cloudflare Workers: there
 * is no shared memory between isolates, so an in-process counter would reset on
 * every cold start and be trivially bypassed by spreading requests around.
 *
 * FAIL CLOSED. If the limiter itself errors we deny the action. These guard
 * spam and abuse surfaces; letting traffic through when the limiter is broken
 * defeats the point.
 */

/** Budgets in one place so limits are reviewable without grepping call sites. */
export const RATE_LIMITS = {
  /** Emails aimed at an ADDRESS (magic link, reset). Keyed on the target. */
  authEmailPerAddress: { max: 3, windowSeconds: 60 * 60 },
  /** All auth email sends from one client, regardless of target address. */
  authEmailPerClient: { max: 8, windowSeconds: 60 * 60 },
  /** Password attempts per client — brute-force brake, not a lockout. */
  authSignInPerClient: { max: 10, windowSeconds: 15 * 60 },
  /**
   * Resolving a sign-in HANDLE to an account email. Spent on top of the
   * sign-in budget, never instead of it, so probing handles can never buy a
   * caller extra password attempts.
   *
   * Same size as the sign-in budget on purpose: signing in by handle must not
   * be stingier than signing in by email for the person who simply mistyped.
   * What it adds is a second, independent brake on the one surface that could
   * otherwise answer "does this handle exist?" faster than a password attempt.
   */
  usernameResolvePerClient: { max: 10, windowSeconds: 15 * 60 },
  /** Account creation per client. */
  authSignUpPerClient: { max: 5, windowSeconds: 60 * 60 },
  /** Team invites sent by one user: the in-app "spam a stranger" vector. */
  teamInvite: { max: 20, windowSeconds: 60 * 60 },
  /**
   * Membership changes (role grants, access revocation). These edit who can do
   * what inside a store, so an automated loop against them is a privilege
   * problem, not just load. Well above any real team's churn.
   */
  teamMembership: { max: 60, windowSeconds: 60 * 60 },
  /** Upload URL minting — each one authorises bytes into R2. */
  uploadPresign: { max: 60, windowSeconds: 60 * 60 },
  /** Handle probing from the settings field. An enumeration brake, and the
   *  handle is half a credential, so the answer is worth something to an
   *  attacker even though the field is public. */
  usernameCheck: { max: 60, windowSeconds: 60 * 60 },
  /**
   * Public embed reads, keyed on the requesting CLIENT (no session exists).
   * Generous, because one page view can legitimately be one request and a
   * popular embedding site shares an egress IP — this is a scraping and cost
   * brake, not an access control. The origin allowlist is the access control.
   */
  embedFetch: { max: 600, windowSeconds: 60 * 60 },
  /** Avatar uploads (pre-existing budget, unchanged). */
  avatarUpload: { max: 5, windowSeconds: 60 * 60 },
  /**
   * Universal search. A READ budget, and the only one spent per keystroke, so
   * it is the loosest here by design: the palette debounces to roughly one
   * request per 300ms of typing, which a determined session of searching can
   * legitimately sustain for a while. What it stops is a script walking the
   * catalogue through the one endpoint that returns rows from five tables at
   * once. Every query is still account-scoped and capped at a handful of rows,
   * so the ceiling is about DB load, not disclosure.
   */
  searchQuery: { max: 600, windowSeconds: 60 * 60 },
  /**
   * The search SNAPSHOT: one compact per-account index fetch, warmed shortly
   * after the shell mounts and refreshed on a 60s client TTL. Remounts (route
   *-group hops, account switches) each spend one; 120/hour clears any human
   * pattern while staying 5x tighter than the per-keystroke budget above.
   */
  searchSnapshot: { max: 120, windowSeconds: 60 * 60 },

  // --- Signed-in write budgets ------------------------------------------
  // These sit on top of RLS and role checks, which already decide WHETHER a
  // caller may write. What they bound is VOLUME: a compromised session or a
  // runaway client can otherwise drive unbounded DB writes and R2 traffic
  // inside its own account. Set well above real human use, so they only ever
  // catch automation.

  /**
   * Email-change requests. The lowest budget here by a wide margin because it
   * is the only signed-in action that sends mail to an address the CALLER
   * supplies — i.e. it can be aimed at a stranger's inbox.
   */
  emailChange: { max: 5, windowSeconds: 60 * 60 },
  /** Reset mail to the account's OWN address; still mail, so still bounded. */
  passwordReset: { max: 5, windowSeconds: 60 * 60 },
  /**
   * The same reset mail, bounded a second time on the CLIENT rather than the
   * user. Not redundant: the per-user budget above is spent by whoever holds a
   * session, so someone working through several compromised sessions gets a
   * fresh 5 per victim. This one caps what a single origin can send in total,
   * so the inbox-flooding cost does not scale with the number of accounts an
   * attacker has reached. Mirrors the pair on the signed-out mail path
   * (authEmailPerAddress + authEmailPerClient).
   */
  passwordResetPerClient: { max: 5, windowSeconds: 60 * 60 },
  /**
   * Re-authentication attempts from inside a session (password change, email
   * change). These VERIFY a caller-supplied password, so an unbounded version
   * is a password oracle a hijacked session could grind against. Tighter than
   * the sign-in budget because a legitimate user knows their own password.
   */
  passwordReauth: { max: 10, windowSeconds: 15 * 60 },
  /** Product create/update/delete: each can head or evict an R2 object. */
  productWrite: { max: 120, windowSeconds: 60 * 60 },
  /** Storefront saves: the heaviest write path (multi-query + R2 verify). */
  storefrontWrite: { max: 240, windowSeconds: 60 * 60 },
  /** Stock edits: a single UPDATE, but trivially scriptable. */
  stockWrite: { max: 240, windowSeconds: 60 * 60 },
  /** Profile / tax / notification-preference writes. */
  settingsWrite: { max: 60, windowSeconds: 60 * 60 },
  /**
   * GDPR data export. Reads the caller's ENTIRE account (profile + every
   * product + every storefront config) in three parallel queries and streams
   * it back as a file. A human exports rarely; anything faster than this is a
   * scripted loop hammering the most expensive read in the app.
   */
  dataExport: { max: 5, windowSeconds: 60 * 60 },
} as const;

export type RateLimitBudget = { max: number; windowSeconds: number };

/**
 * Hash before storing. Rate-limit keys are emails and IP addresses; hashing
 * keeps the limiter from quietly becoming a log of who tried to sign in from
 * where. Sliding-window state only needs equality, so a digest is sufficient.
 *
 * Not a password hash and not trying to be: the point is to avoid persisting
 * plaintext identifiers, not to resist offline cracking of a known-small space.
 */
async function hashKey(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Take from the SIGNED-IN user's budget for `action`. Identity comes from
 * auth.uid() inside Postgres — never from an argument — so one user can neither
 * spend nor inspect another's budget.
 *
 * Returns true when the action may proceed.
 */
export async function rateLimit(
  action: string,
  budget: RateLimitBudget,
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rl_take", {
      p_action: action,
      p_max: budget.max,
      p_window_seconds: budget.windowSeconds,
    });
    if (error) {
      console.warn(`[rate-limit] ${action} check failed:`, error.message);
      return false; // fail closed
    }
    return data === true;
  } catch (err) {
    console.warn(
      `[rate-limit] ${action} threw:`,
      err instanceof Error ? err.message : String(err),
    );
    return false; // fail closed
  }
}

/**
 * Take from a budget keyed on an arbitrary identifier, for surfaces with no
 * session yet (sending a magic link, a reset email, signing up).
 *
 * `rawKey` is hashed here and the RPC is service_role-only, so a client can
 * never call it directly with a key of its own choosing — which would make the
 * limit meaningless.
 */
export async function rateLimitKey(
  rawKey: string,
  action: string,
  budget: RateLimitBudget,
): Promise<boolean> {
  if (!rawKey) return false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rl_take_key", {
      p_key: await hashKey(rawKey),
      p_action: action,
      p_max: budget.max,
      p_window_seconds: budget.windowSeconds,
    });
    if (error) {
      console.warn(`[rate-limit] ${action} (keyed) check failed:`, error.message);
      return false; // fail closed
    }
    return data === true;
  } catch (err) {
    console.warn(
      `[rate-limit] ${action} (keyed) threw:`,
      err instanceof Error ? err.message : String(err),
    );
    return false; // fail closed
  }
}

/**
 * Best-effort client identity for anonymous limits.
 *
 * On Cloudflare, CF-Connecting-IP is set by the edge and cannot be spoofed by
 * the client. The x-forwarded-for fallback is only for local dev — a client CAN
 * forge that header, so anonymous limits are defence-in-depth (paired with a
 * per-target-address limit that no header can influence), never the sole guard.
 */
export async function clientKey(headerList: Headers): Promise<string> {
  return (
    headerList.get("cf-connecting-ip") ??
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown-client"
  );
}
