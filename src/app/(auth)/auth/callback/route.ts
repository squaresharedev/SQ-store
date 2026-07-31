import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/utils/safe-path";

/**
 * OAuth / PKCE code exchange. Also handles the default Supabase email links
 * (confirmation, magic link, password recovery) which redirect here with a
 * `?code=` param. Route Handlers may write cookies, so the exchanged session is
 * persisted here. Node runtime (no `export const runtime = "edge"`).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.warn("[auth] code exchange failed", error.code, error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}

function sanitizeNext(next: string | null): string {
  return safeInternalPath(next);
}
