/**
 * THE SWITCH for the whole agent surface: /mcp, /oauth/* and the discovery
 * documents. Off (the default, and in any build that does not set it), they
 * answer 404, so it can be turned off at once without touching a grant. The
 * Connected apps page stays up, so a seller can still disconnect an app. See
 * LAUNCH SWITCHES in wrangler.jsonc.
 *
 * Read at runtime on purpose: it is a server var, never in a browser bundle.
 */
export function agentAccessEnabled(): boolean {
  return process.env.AGENT_ACCESS_ENABLED === "true";
}

/**
 * THE SWITCH for previews an assistant asks for (preview_storefront and the
 * pages it photographs, lib/agent/preview). Off unless set, and only ever on
 * under the agent switch above. See LAUNCH SWITCHES in wrangler.jsonc.
 */
export function agentPreviewEnabled(): boolean {
  return agentAccessEnabled() && process.env.AGENT_PREVIEW_ENABLED === "true";
}

/**
 * Whether this store may connect an assistant at all. Every plan may today.
 * This is the one place to gate it on a plan later.
 */
export function agentAccessAllowedForStore(): boolean {
  return true;
}
