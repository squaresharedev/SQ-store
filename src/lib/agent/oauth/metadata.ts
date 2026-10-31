import { agentAccessEnabled } from "@/lib/agent/access";
import {
  OAUTH_AUTHORIZE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_REVOKE_PATH,
  OAUTH_TOKEN_PATH,
  mcpResourceUrl,
  oauthIssuer,
} from "@/lib/agent/paths";
import { AGENT_SCOPE_IDS } from "@/lib/agent/scopes";

/**
 * The discovery documents. Public, cookie-free and the same for everyone, so any
 * origin may read them: a browser-based client has to be able to.
 */
export const OPEN_TO_ANY_ORIGIN = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

function document(body: unknown): Response {
  if (!agentAccessEnabled()) return new Response(null, { status: 404 });
  return Response.json(body, {
    headers: { ...OPEN_TO_ANY_ORIGIN, "cache-control": "public, max-age=300" },
  });
}

/** RFC 9728: what this resource is and who issues its tokens. */
export function protectedResourceMetadata(): Response {
  return document({
    resource: mcpResourceUrl(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: AGENT_SCOPE_IDS,
    bearer_methods_supported: ["header"],
    resource_name: "Square Share",
  });
}

/** RFC 8414: how to get a token. */
export function authorizationServerMetadata(): Response {
  const issuer = oauthIssuer();
  return document({
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}${OAUTH_TOKEN_PATH}`,
    registration_endpoint: `${issuer}${OAUTH_REGISTER_PATH}`,
    revocation_endpoint: `${issuer}${OAUTH_REVOKE_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: AGENT_SCOPE_IDS,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  });
}

/** The answer to a browser's preflight. */
export function preflight(): Response {
  if (!agentAccessEnabled()) return new Response(null, { status: 404 });
  return new Response(null, { status: 204, headers: OPEN_TO_ANY_ORIGIN });
}

/** An OAuth error response (RFC 6749 5.2). */
export function oauthError(status: number, error: string, description?: string): Response {
  return Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { ...OPEN_TO_ANY_ORIGIN, "cache-control": "no-store" } },
  );
}
