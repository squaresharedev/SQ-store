/**
 * Has this password turned up in a known data breach? Asked of Have I Been
 * Pwned's range API, the complement to lib/auth/password.ts: that rule knows
 * the short head of common passwords and the person's own identity, this one
 * knows the hundreds of millions of real passwords already in attackers' lists.
 * (Supabase's own breach check needs a paid plan, so the app asks itself.)
 *
 * K-ANONYMITY. Only the first five hex characters of the password's SHA-1 ever
 * leave; the service answers with every suffix sharing that prefix, and the
 * match happens here. Padded responses keep the answer's size from hinting.
 *
 * FAIL-OPEN, deliberately: a slow or unreachable service must not stop anyone
 * setting a password. The local rules above still apply either way.
 *
 * SERVER ONLY (a network call per check; run it after the cheap local rules).
 */

const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";
/** How long to wait before giving up and letting the password through. */
const PWNED_TIMEOUT_MS = 2500;
/** Hex characters of the hash sent to the service. */
const PREFIX_LENGTH = 5;

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** True only when the service positively lists this password. */
export async function passwordIsBreached(password: string): Promise<boolean> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, PREFIX_LENGTH);
    const suffix = hash.slice(PREFIX_LENGTH);
    const response = await fetch(`${PWNED_RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(PWNED_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body = await response.text();
    for (const line of body.split("\n")) {
      const [candidate, count] = line.trim().split(":");
      // Padding rows carry a count of 0: they are not real passwords.
      if (candidate === suffix) return Number(count) > 0;
    }
    return false;
  } catch (err) {
    console.error("[auth] breached-password check failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}
