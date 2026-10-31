import { isPkceChallenge } from "@/lib/agent/oauth/crypto";
import { resolveClient, type AgentClient } from "@/lib/agent/oauth/clients";
import { redirectUriMatches, redirectWith } from "@/lib/agent/oauth/redirects";
import { mcpResourceUrl, oauthIssuer } from "@/lib/agent/paths";
import { parseScopeParam } from "@/lib/agent/scopes";

/**
 * Judging an authorization request. The consent page runs this to decide what
 * to show, and the approve action runs it AGAIN on what the form sent back,
 * because everything in a form is the caller's to change.
 *
 * Two kinds of refusal (RFC 6749 4.1.2.1):
 *   - the client or redirect URI is wrong: nothing can be trusted, so the page
 *     says so and never redirects;
 *   - anything else: the app is told at its own redirect URI.
 */

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  resource: string;
  requestedScopes: string[];
};

export type AuthorizeRequest =
  | { kind: "ok"; client: AgentClient; params: AuthorizeParams }
  /** Show this on the page. There is nowhere safe to send it. */
  | { kind: "fatal"; reason: "unknown_client" | "bad_redirect" }
  /** Send the app back here. */
  | { kind: "redirect"; to: string };

/** Bounds on echoed values: a request is not a place to store a novel. */
const STATE_MAX = 2000;

type RawParams = Record<string, string | undefined>;

export async function judgeAuthorizeRequest(raw: RawParams): Promise<AuthorizeRequest> {
  const clientId = raw.client_id ?? "";
  const redirectUri = raw.redirect_uri ?? "";

  const client = await resolveClient(clientId);
  if (!client) return { kind: "fatal", reason: "unknown_client" };
  if (!redirectUriMatches(redirectUri, client.redirectUris)) {
    return { kind: "fatal", reason: "bad_redirect" };
  }

  const state = raw.state;
  const refuse = (error: string, description: string): AuthorizeRequest => ({
    kind: "redirect",
    to: redirectWith(redirectUri, {
      error,
      error_description: description,
      state,
      iss: oauthIssuer(),
    }),
  });

  if (state !== undefined && state.length > STATE_MAX) {
    return refuse("invalid_request", "state is too long.");
  }
  if (raw.response_type !== "code") {
    return refuse("unsupported_response_type", "Only response_type=code is supported.");
  }
  if (raw.code_challenge_method !== "S256" || !isPkceChallenge(raw.code_challenge ?? "")) {
    return refuse("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  // Absent is tolerated: older clients omit it, and this server has one
  // resource, so there is only one thing the token could be for.
  const resource = raw.resource || mcpResourceUrl();
  if (resource !== mcpResourceUrl()) {
    return refuse("invalid_target", "This server only issues tokens for its own MCP endpoint.");
  }

  return {
    kind: "ok",
    client,
    params: {
      clientId: client.id,
      redirectUri,
      state,
      codeChallenge: raw.code_challenge ?? "",
      resource,
      requestedScopes: parseScopeParam(raw.scope),
    },
  };
}

/** Where to send the app when the person says no. */
export function deniedRedirect(params: Pick<AuthorizeParams, "redirectUri" | "state">): string {
  return redirectWith(params.redirectUri, {
    error: "access_denied",
    state: params.state,
    iss: oauthIssuer(),
  });
}
