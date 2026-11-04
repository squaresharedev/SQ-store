import { appOrigin } from "@/lib/app-url";

/** Where the agent surface lives, in one place. Pure strings: safe anywhere. */
export const MCP_PATH = "/mcp";
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REGISTER_PATH = "/oauth/register";
export const OAUTH_REVOKE_PATH = "/oauth/revoke";
export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
export const CONNECTED_APPS_PATH = "/settings/connected-apps";

/** The page a storefront preview photographs (lib/agent/preview). */
export const AGENT_STOREFRONT_PREVIEW_PATH = "/agent-preview/storefront";

/** A storefront preview page, opened with its two-minute token. */
export function storefrontPreviewUrl(storefrontId: string, token: string): string {
  return `${appOrigin()}${AGENT_STOREFRONT_PREVIEW_PATH}/${storefrontId}?t=${encodeURIComponent(token)}`;
}

/** The page a product page preview photographs (lib/agent/preview). */
export const AGENT_PRODUCT_PREVIEW_PATH = "/agent-preview/product";

/** A product page preview page, drawn in one storefront's look. */
export function productPagePreviewUrl(productId: string, storefrontId: string, token: string): string {
  return `${appOrigin()}${AGENT_PRODUCT_PREVIEW_PATH}/${productId}?s=${encodeURIComponent(storefrontId)}&t=${encodeURIComponent(token)}`;
}

/** The MCP Apps view a storefront preview is shown in (lib/agent/preview/view.ts). */
export const STOREFRONT_PREVIEW_VIEW_URI = "ui://square-share/storefront-preview";

/** The MCP Apps view a product page preview is shown in: the same view. */
export const PRODUCT_PAGE_PREVIEW_VIEW_URI = "ui://square-share/product-page-preview";

/** The MCP Apps view publish_products answers in (lib/agent/preview/publish-card.ts). */
export const PUBLISH_CARD_VIEW_URI = "ui://square-share/publish-card";

/** Where a person adds a custom connector in Claude (Settings > Connectors). */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

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
