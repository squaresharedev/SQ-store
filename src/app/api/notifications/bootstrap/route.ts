import { getRealtimeToken } from "@/lib/notifications/actions";
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
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return new Response(null, { status: 403, headers: NO_STORE });

  const snapshot = await getNotificationSnapshot();
  // No session, no token to hand out, and no second read to make.
  const body: BellBootstrap = { snapshot, token: snapshot ? await getRealtimeToken() : null };
  return Response.json(body, { headers: NO_STORE });
}
