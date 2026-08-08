import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emailOtpTypeSchema } from "@/lib/validation/auth";
import { safeInternalPath } from "@/lib/utils/safe-path";

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
    const { error } = await supabase.auth.verifyOtp({
      type: type.data,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.warn("[auth] otp verification failed", error.code, error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_confirm`);
}

function sanitizeNext(next: string | null): string {
  return safeInternalPath(next);
}
