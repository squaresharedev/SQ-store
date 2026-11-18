import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getNotificationSnapshot } from "@/lib/notifications/queries";
import type { BellBootstrap } from "@/lib/notifications/bootstrap";

/**
 * GET /api/notifications/bootstrap: what the notification bell needs to start
 * (lib/notifications/bootstrap.ts says why this is a route and not a server
 * action): the signed-in person's recent notifications and unread count, and
 * their own short-lived access token for the Realtime subscription.
 *
 * NOTHING IS TAKEN FROM THE REQUEST. Whose notifications, and whose token, is
 * the session's; both reads go through the same functions the bell's server
 * actions used, with the same row-level rules. Signed out, the answer is two
 * nulls, not an error.
 *
 * SAME SITE ONLY. The token is this user's own and is already theirs to hold,
 * but it is not another site's to ask for: a request a browser marks as coming
 * from elsewhere is refused. (The response is not readable cross-origin either
 * way; this refuses it before the reads.) Never cached.
 *
 * SINGLE AUTH CALL. getUser() validates the session once. Snapshot and token
 * reads both need the validated user; calling getUser() again inside each
 * (as the old getRealtimeToken() helper did) would be two Auth round-trips.
 * Instead: pass the already-resolved user into getNotificationSnapshot() and
 * read the access token from getSession() directly (the token is already in
 * memory after getUser() refreshed it). The two reads run in parallel.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return new Response(null, { status: 403, headers: NO_STORE });

  // One Auth call covers both reads below. No session: respond with nulls
  // rather than an error so the bell shows its static state rather than
  // breaking the page it sits on.
  const user = await getUser();
  if (!user) {
    const body: BellBootstrap = { snapshot: null, token: null };
    return Response.json(body, { headers: NO_STORE });
  }

  // Snapshot and session read in parallel: getNotificationSnapshot() does its
  // DB reads; getSession() reads the access token that getUser() already
  // validated and left in the in-memory SSR cookie store.
  const supabase = await createClient();
  const [snapshot, { data: { session } }] = await Promise.all([
    getNotificationSnapshot(user),
    supabase.auth.getSession(),
  ]);

  const token = snapshot ? (session?.access_token ?? null) : null;
  const body: BellBootstrap = { snapshot, token };
  return Response.json(body, { headers: NO_STORE });
}
