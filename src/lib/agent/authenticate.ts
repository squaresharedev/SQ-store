import type { AgentContext } from "@/lib/agent/context";
import { mintAgentJwt } from "@/lib/agent/mint";
import { ACCESS_TOKEN_PREFIX } from "@/lib/agent/oauth/crypto";
import { grantForAccessToken } from "@/lib/agent/oauth/grants";
import { mcpResourceUrl } from "@/lib/agent/paths";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * From an Authorization header to an AgentContext, or the reason not.
 *
 *   missing       no bearer token: the 401 that starts discovery
 *   invalid       a token we do not honour: expired, revoked, or for another
 *                 resource, or its owner is banned or gone
 *   unavailable   we could not find out. Never answered as "invalid", which
 *                 would make a client throw its connection away over a blip.
 */
export type AgentAuthentication =
  | { kind: "ok"; context: AgentContext }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/** What the Bearer scheme allows, bounded: this is unauthenticated input. */
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-._~+/]{1,512}=*)$/;

export async function authenticateAgentRequest(request: Request): Promise<AgentAuthentication> {
  const header = request.headers.get("authorization");
  if (!header) return { kind: "missing" };
  const token = BEARER_PATTERN.exec(header)?.[1];
  // The prefix check saves a database read on anything that was never ours,
  // such as a browser's Supabase JWT, which must not work here.
  if (!token?.startsWith(ACCESS_TOKEN_PREFIX)) return { kind: "invalid" };

  try {
    const grant = await grantForAccessToken(token);
    // RFC 8707: a token is good for the resource it was issued for, only.
    if (!grant || grant.resource !== mcpResourceUrl()) return { kind: "invalid" };

    const { data, error } = await createAdminClient().auth.admin.getUserById(grant.userId);
    if (error || !data.user) return { kind: "invalid" };
    const bannedUntil = data.user.banned_until ? Date.parse(data.user.banned_until) : 0;
    if (bannedUntil > Date.now()) return { kind: "invalid" };

    return {
      kind: "ok",
      context: {
        user: data.user,
        accountId: grant.accountId,
        grantId: grant.id,
        clientId: grant.clientId,
        scopes: new Set(grant.scopes),
        jwt: await mintAgentJwt(data.user, grant.id),
      },
    };
  } catch (error) {
    console.error("[agent] authentication failed:", error instanceof Error ? error.message : String(error));
    return { kind: "unavailable" };
  }
}
