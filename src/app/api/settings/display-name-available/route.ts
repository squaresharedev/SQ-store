import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { displayNameSchema } from "@/lib/validation/settings";

/**
 * GET /api/settings/display-name-available?name=foo — live availability
 * check backing the checkmark/cross indicator on the settings name field.
 * A user's name is also their unique handle: no separate username.
 *
 * Auth-gated so this can't become an unauthenticated name-enumeration
 * oracle. The actual cross-user lookup runs through the
 * is_display_name_available SQL function (SECURITY DEFINER), which excludes
 * the caller's own row via auth.uid() read from their own JWT — never a
 * client-supplied id — so typing your own current name back correctly reads
 * as available. That function's EXECUTE grant is authenticated-only (no
 * anon), so this route is the only way in even at the PostgREST layer.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = displayNameSchema.safeParse({
    display_name: searchParams.get("name") ?? "",
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid name." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: available, error } = await supabase.rpc(
    "is_display_name_available",
    { p_display_name: parsed.data.display_name },
  );
  if (error) {
    console.error("[settings] name availability check failed:", error.message);
    return Response.json({ error: "Could not check availability." }, { status: 500 });
  }

  return Response.json({ available });
}
