import { appOrigin } from "@/lib/app-url";

/** Where the agent surface lives, in one place. Pure strings: safe anywhere. */
export const MCP_PATH = "/mcp";
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REGISTER_PATH = "/oauth/register";
export const OAUTH_REVOKE_PATH = "/oauth/revoke";
export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
export const CONNECTED_APPS_PATH = "/settings/connected-apps";

/** This server's identity as an OAuth issuer. */
export function oauthIssuer(): string {
  return appOrigin();
}

/** The canonical URL of the MCP server: what a token is bound to (RFC 8707). */
export function mcpResourceUrl(): string {
  return `${appOrigin()}${MCP_PATH}`;
}

/** The discovery document a 401 from /mcp points at (RFC 9728). */
export function protectedResourceMetadataUrl(): string {
  return `${appOrigin()}${PROTECTED_RESOURCE_METADATA_PATH}`;
}
