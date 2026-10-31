import { agentAccessEnabled } from "@/lib/agent/access";
import { revokeToken } from "@/lib/agent/oauth/grants";
import { OPEN_TO_ANY_ORIGIN, preflight } from "@/lib/agent/oauth/metadata";

/**
 * POST /oauth/revoke (RFC 7009): an app disconnects itself. Answers 200 whether
 * or not the token meant anything, as the RFC says: this must not be a way to
 * test which tokens are real.
 */
export const dynamic = "force-dynamic";

const BODY_MAX_BYTES = 4 * 1024;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  if (!agentAccessEnabled()) return new Response(null, { status: 404 });
  const raw = await request.text();
  if (raw.length <= BODY_MAX_BYTES) {
    const token = new URLSearchParams(raw).get("token");
    if (token) await revokeToken(token);
  }
  return new Response(null, { status: 200, headers: { ...OPEN_TO_ANY_ORIGIN, "cache-control": "no-store" } });
}
