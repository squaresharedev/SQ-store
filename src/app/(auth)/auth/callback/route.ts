import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasVerifiedFactor } from "@/lib/auth/assurance";
import { twoFactorChallengePath } from "@/lib/auth/session";
import {
  LAST_SIGN_IN_COOKIE,
  parseSignInMethod,
} from "@/lib/auth/last-method";
import { safeInternalPath } from "@/lib/utils/safe-path";
import { LOCALE_COOKIE } from "@/i18n/cookie";
import { localeForSignedInBrowser } from "@/i18n/sign-in";

/**
 * OAuth / PKCE code exchange. Also handles the default Supabase email links
 * (confirmation, magic link, password recovery) which redirect here with a
 * `?code=` param. Route Handlers may write cookies, so the exchanged session is
 * persisted here. Node runtime (no `export const runtime = "edge"`).
 *
 * If sign-in never reaches this route and the browser lands on the ROOT of
 * another host with `?code=` instead, this file is not the problem: Supabase
 * dropped a `redirect_to` that isn't in its allowlist and fell back to the
 * project's Site URL. See docs/auth-urls.md.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  // Which sign-in option sent the user here, when the sender said so. Absent
  // for a signup confirmation or a password recovery, which arrive the same
  // way but are not a choice of method. Parsed against the known list, since
  // it is a URL param and lands in a Set-Cookie header.
  const method = parseSignInMethod(searchParams.get("method"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Google, a magic link and a password-recovery link are all FIRST
      // factors. For an account with 2FA on, the session they produce is aal1
      // and still owes its code, recovery links included: an inbox is not a
      // second factor, so a reset link must never skip the challenge.
      const owesSecondFactor = hasVerifiedFactor(data.user);
      const destination = owesSecondFactor
        ? twoFactorChallengePath(next)
        : next;
      const response = NextResponse.redirect(`${origin}${destination}`);
      // An aal1 session cannot read an enrolled account's profile (RLS), so
      // for those the language is copied when the challenge completes instead.
      if (!owesSecondFactor) {
        const accountLocale = await localeForSignedInBrowser(
          supabase,
          data.user.id,
          (await cookies()).get(LOCALE_COOKIE.name)?.value,
        );
        if (accountLocale) {
          response.cookies.set(
            LOCALE_COOKIE.name,
            accountLocale,
            LOCALE_COOKIE.options,
          );
        }
      }
      // Set on the response rather than through `cookies()`: this handler
      // returns a redirect it built itself, and that is the response the
      // browser actually receives.
      if (method) {
        response.cookies.set(
          LAST_SIGN_IN_COOKIE.name,
          method,
          LAST_SIGN_IN_COOKIE.options,
        );
      }
      return response;
    }
    console.warn("[auth] code exchange failed", error.code, error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}

function sanitizeNext(next: string | null): string {
  return safeInternalPath(next);
}
