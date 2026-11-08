import { agentAccessEnabled } from "@/lib/agent/access";
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX, isCredential } from "@/lib/agent/oauth/crypto";
import { revokeToken } from "@/lib/agent/oauth/grants";
import { OPEN_TO_ANY_ORIGIN, preflight } from "@/lib/agent/oauth/metadata";
import { readBoundedText } from "@/lib/security/read-json";

/**
 * POST /oauth/revoke (RFC 7009): an app disconnects itself. Answers 200 whether
 * or not the token meant anything, as the RFC says: this must not be a way to
 * test which tokens are real.
 *
 * Public and unauthenticated by design, so it does the least it can for a
 * stranger: the body is read only up to its cap (never buffered whole first),
 * and a token that is not shaped like one of ours never reaches the database.
 */
export const dynamic = "force-dynamic";

const BODY_MAX_BYTES = 4 * 1024;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  if (!agentAccessEnabled()) return new Response(null, { status: 404 });
  const body = await readBoundedText(request, BODY_MAX_BYTES);
  if (body.ok) {
    const token = new URLSearchParams(body.text).get("token");
    if (token && (isCredential(token, ACCESS_TOKEN_PREFIX) || isCredential(token, REFRESH_TOKEN_PREFIX))) {
      await revokeToken(token);
    }
  }
  return new Response(null, { status: 200, headers: { ...OPEN_TO_ANY_ORIGIN, "cache-control": "no-store" } });
}
