import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  LAST_SIGN_IN_COOKIE,
  parseSignInMethod,
} from "@/lib/auth/last-method";
import { safeInternalPath } from "@/lib/utils/safe-path";

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
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
