import { cookies } from "next/headers";
import {
  AUTH_COOKIE_DOMAIN,
  AUTH_COOKIE_SECURE,
} from "@/lib/supabase/cookie-options";

/**
 * Remembers WHICH sign-in option this browser used last, so a returning user
 * doesn't have to remember whether they were a Google account or a password
 * one. The login page renders a "Last used" pill on that option.
 *
 * A hint, nothing more: it never pre-fills a credential, never changes what is
 * offered, and being wrong or absent costs a returning user only the memory
 * they had to use before. So it is deliberately cheap.
 *
 * HttpOnly even though nothing secret is in it — only the server reads it (the
 * login page passes the value down as a prop), so there is no reason to hand
 * `document.cookie` a per-browser fact about the account holder. Rendering it
 * server-side also means no flash of an unbadged form on load.
 *
 * WHERE IT IS SET: the method is recorded when a sign-in actually SUCCEEDS,
 * never when one is merely attempted. Password sign-in is the only path that
 * completes inside its own action; Google and magic link both finish in
 * /auth/callback, so they carry the method through the callback URL as an
 * explicit `method` param rather than having the callback guess from the
 * exchanged user's provider. Guessing cannot tell a magic link apart from a
 * signup confirmation or a password recovery, which arrive the same way and
 * are not a choice of sign-in method at all.
 */

export const SIGN_IN_METHODS = ["google", "password", "magic"] as const;

export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

const COOKIE_NAME = "sq_last_signin";

/** A year. The hint is only useful to someone who has been away a while. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Narrow untrusted input (a URL param, a cookie value) to a known method. */
export function parseSignInMethod(
  value: string | null | undefined,
): SignInMethod | null {
  return SIGN_IN_METHODS.find((method) => method === value) ?? null;
}

/** Cookie attributes, shared with the callback route (which writes onto its
 *  own redirect response rather than through `cookies()`). */
export const LAST_SIGN_IN_COOKIE = {
  name: COOKIE_NAME,
  options: {
    domain: AUTH_COOKIE_DOMAIN,
    path: "/",
    sameSite: "lax",
    secure: AUTH_COOKIE_SECURE,
    httpOnly: true,
    maxAge: MAX_AGE_SECONDS,
  },
} as const;

/** Record the method that just signed this browser in. */
export async function rememberSignInMethod(method: SignInMethod): Promise<void> {
  const store = await cookies();
  store.set(LAST_SIGN_IN_COOKIE.name, method, LAST_SIGN_IN_COOKIE.options);
}

/** The method this browser last signed in with, or null if never / unknown. */
export async function readSignInMethod(): Promise<SignInMethod | null> {
  const store = await cookies();
  return parseSignInMethod(store.get(LAST_SIGN_IN_COOKIE.name)?.value);
}
