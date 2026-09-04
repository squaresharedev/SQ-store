/**
 * CLOUDFLARE TURNSTILE — bot protection on sign-up.
 *
 * Mirrors lib/moderation's shape: OFF unless TURNSTILE_SECRET_KEY is set, so
 * local dev and the e2e stack (neither of which carries Cloudflare
 * credentials) see the ordinary, unblocked form. Once configured, it FAILS
 * CLOSED — same rule as the rate limiter: a token that fails to verify, is
 * missing, or can't be checked because Cloudflare is unreachable all refuse
 * the signup rather than letting it through unchecked.
 *
 * The public site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY) is meant to be public —
 * it identifies the widget, not a secret — and is read directly by the client
 * component that renders it. This module only ever touches the SECRET key,
 * which must never reach the browser.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Is the widget actually configured? Used to decide whether the client
 *  should even render it, and to fail loudly if the two env vars disagree. */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Verify a solved Turnstile token with Cloudflare.
 *
 * `remoteIp` is optional context Cloudflare uses for its own risk scoring; a
 * missing or unreliable value (localhost, a spoofable dev header) does not
 * invalidate an otherwise-good token.
 */
export async function verifyTurnstile(
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // feature disabled: nothing to enforce
  if (!token) return false; // configured, but the caller solved nothing

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) {
      console.warn(`[turnstile] siteverify responded ${res.status}`);
      return false; // fail closed
    }
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch (err) {
    console.warn(
      "[turnstile] siteverify request failed:",
      err instanceof Error ? err.message : String(err),
    );
    return false; // fail closed
  }
}
