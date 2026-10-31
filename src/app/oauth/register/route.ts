import { headers } from "next/headers";
import { agentAccessEnabled } from "@/lib/agent/access";
import { parseClientMetadata, registerClient } from "@/lib/agent/oauth/clients";
import { OPEN_TO_ANY_ORIGIN, oauthError, preflight } from "@/lib/agent/oauth/metadata";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/security/read-json";

/**
 * POST /oauth/register: an app registers itself (RFC 7591). Open, because an MCP
 * client meets this server with no prior arrangement. Registering grants nothing:
 * the seller still has to approve the app, and the consent page shows where its
 * approval would go.
 */
export const dynamic = "force-dynamic";

const BODY_MAX_BYTES = 16 * 1024;

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  if (!agentAccessEnabled()) return new Response(null, { status: 404 });

  const client = await clientKey(await headers());
  if (!(await rateLimitKey(client, "agent_register", RATE_LIMITS.agentRegister))) {
    return oauthError(429, "too_many_requests", "Too many registrations from this address.");
  }

  const body = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!body.ok) return oauthError(400, "invalid_client_metadata", "The request body must be JSON.");

  const metadata = parseClientMetadata(body.value);
  if (!metadata.ok) return oauthError(400, metadata.error, metadata.description);

  const registered = await registerClient(metadata);
  if (!registered) return oauthError(500, "server_error", "Please try again.");

  return Response.json(
    {
      client_id: registered.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: registered.name,
      redirect_uris: registered.redirectUris,
      application_type: registered.applicationType,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: { ...OPEN_TO_ANY_ORIGIN, "cache-control": "no-store" } },
  );
}
