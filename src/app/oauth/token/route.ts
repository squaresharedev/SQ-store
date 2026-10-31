import { headers } from "next/headers";
import { agentAccessEnabled } from "@/lib/agent/access";
import { isPkceVerifier } from "@/lib/agent/oauth/crypto";
import { exchangeAuthCode, rotateRefreshToken, type ExchangeResult } from "@/lib/agent/oauth/grants";
import { OPEN_TO_ANY_ORIGIN, oauthError, preflight } from "@/lib/agent/oauth/metadata";
import { mcpResourceUrl } from "@/lib/agent/paths";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";

/**
 * POST /oauth/token: the OAuth token endpoint. Form encoded, as RFC 6749 says.
 * Public clients, so nothing here is a secret but the code and its PKCE verifier.
 */
export const dynamic = "force-dynamic";

/** Bounded before parsing: this is unauthenticated input. */
const BODY_MAX_BYTES = 8 * 1024;

export function OPTIONS(): Response {
  return preflight();
}

function tokenResponse(result: ExchangeResult): Response {
  if (!result.ok) return oauthError(result.error === "server_error" ? 500 : 400, result.error, result.description);
  const { tokens } = result;
  return Response.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope,
    },
    { headers: { ...OPEN_TO_ANY_ORIGIN, "cache-control": "no-store", pragma: "no-cache" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!agentAccessEnabled()) return new Response(null, { status: 404 });

  const client = await clientKey(await headers());
  if (!(await rateLimitKey(client, "agent_token", RATE_LIMITS.agentToken))) {
    return oauthError(429, "too_many_requests", "Too many attempts from this address.");
  }

  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) return oauthError(400, "invalid_request", "The request is too large.");
  const form = new URLSearchParams(raw);
  const field = (name: string) => form.get(name) ?? "";

  const resource = form.get("resource");
  if (resource !== null && resource !== mcpResourceUrl()) {
    return oauthError(400, "invalid_target", "This server only issues tokens for its own MCP endpoint.");
  }
  const clientId = field("client_id");
  if (!clientId) return oauthError(400, "invalid_request", "client_id is required.");

  switch (field("grant_type")) {
    case "authorization_code": {
      if (!isPkceVerifier(field("code_verifier"))) {
        return oauthError(400, "invalid_request", "A PKCE code_verifier is required.");
      }
      return tokenResponse(
        await exchangeAuthCode({
          code: field("code"),
          codeVerifier: field("code_verifier"),
          redirectUri: field("redirect_uri"),
          clientId,
        }),
      );
    }
    case "refresh_token":
      return tokenResponse(await rotateRefreshToken({ refreshToken: field("refresh_token"), clientId }));
    default:
      return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  }
}
