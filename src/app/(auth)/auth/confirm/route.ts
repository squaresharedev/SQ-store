import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasVerifiedFactor } from "@/lib/auth/assurance";
import { twoFactorChallengePath } from "@/lib/auth/session";
import { emailOtpTypeSchema } from "@/lib/validation/auth";
import { safeInternalPath } from "@/lib/utils/safe-path";
import { LOCALE_COOKIE } from "@/i18n/cookie";
import { localeForSignedInBrowser } from "@/i18n/sign-in";

/**
 * Token-hash verification — the recommended server-side flow for @supabase/ssr.
 * Use this by switching the Supabase email templates to a link of the form:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
 * Handles email confirmation, magic link, and password recovery types.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  // Parsed against the closed set, not cast: Supabase widens EmailOtpType with
  // `(string & {})`, so a cast here would wave through any query string.
  const type = emailOtpTypeSchema.safeParse(searchParams.get("type"));
  const next = sanitizeNext(searchParams.get("next"));

  if (tokenHash && type.success) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type: type.data,
      token_hash: tokenHash,
    });
    if (!error) {
      // Same rule as /auth/callback: an emailed link is a first factor, so an
      // account with 2FA on still owes its code before going anywhere.
      const owesSecondFactor = hasVerifiedFactor(data.user);
      const destination = owesSecondFactor
        ? twoFactorChallengePath(next)
        : next;
      const response = NextResponse.redirect(`${origin}${destination}`);
      // As in /auth/callback: an enrolled account's language is copied when
      // the challenge completes, since this aal1 session cannot read it.
      if (data.user && !owesSecondFactor) {
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
      return response;
    }
    console.warn("[auth] otp verification failed", error.code, error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_confirm`);
}

function sanitizeNext(next: string | null): string {
  return safeInternalPath(next);
}
