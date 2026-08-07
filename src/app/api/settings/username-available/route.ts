import { getUser } from "@/lib/auth/session";
import { isUsernameTaken } from "@/lib/auth/handles";
import { usernameSchema } from "@/lib/validation/auth";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * GET /api/settings/username-available?name=foo — live availability check
 * behind the checkmark on the settings handle field.
 *
 * The handle is a SIGN-IN credential, so "does this one exist?" is worth more
 * to an attacker than the same question about a display name. Two things keep
 * that in hand:
 *
 *  1. Auth-gated and rate limited here, so it is never an anonymous oracle and
 *     a signed-in caller can't walk a dictionary through it either.
 *  2. The lookup runs through the service-role admin client rather than a new
 *     RPC. username_taken is granted to service_role ALONE, so unlike
 *     a display-name availability RPC, there is no function an authenticated caller
 *     could reach straight through PostgREST, bypassing this route's gate.
 *
 * The caller's own id is excluded, so typing back the handle you already hold
 * reads as available. That id comes from the session here, never the query.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  if (!(await rateLimit("username_check", RATE_LIMITS.usernameCheck))) {
    return Response.json(
      { error: "Too many checks. Try again shortly." },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = usernameSchema.safeParse({
    username: searchParams.get("name") ?? "",
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid username." }, { status: 400 });
  }

  const taken = await isUsernameTaken(parsed.data.username, user.id);
  if (taken === null) {
    return Response.json(
      { error: "Could not check availability." },
      { status: 500 },
    );
  }

  return Response.json({ available: !taken });
}
