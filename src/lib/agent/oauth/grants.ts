import {
  ACCESS_TOKEN_PREFIX,
  AUTH_CODE_PREFIX,
  REFRESH_TOKEN_PREFIX,
  pkceChallenge,
  randomCredential,
  sha256Hex,
} from "@/lib/agent/oauth/crypto";
import { redirectUriMatches } from "@/lib/agent/oauth/redirects";
import { knownScopes, type AgentScope } from "@/lib/agent/scopes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The one module that reads and writes grants, codes and tokens. Service role,
 * because no client role can reach these tables; every function that acts for a
 * person takes that person's id and filters on it.
 */

/** An access token's life. Short, because a refresh is cheap and a theft is not. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** A refresh token's life, renewed on each use: a connection left idle this
 *  long has to be approved again. */
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_SECONDS = 60;
/** How close together two refreshes with one token can be and still be a
 *  client's own retry rather than a theft. */
const REFRESH_RETRY_GRACE_MS = 10_000;
/** How often "last used" is written: a date on a settings page needs no more. */
const LAST_USED_WRITE_MS = 5 * 60 * 1000;

function secondsFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export type NewGrant = {
  userId: string;
  accountId: string;
  clientId: string;
  scopes: AgentScope[];
  resource: string;
};

/**
 * Record an approval and mint its single-use code. A live connection for the
 * same person, store and app is replaced: approving again is how a seller
 * changes what an app may do.
 */
export async function createGrantWithCode(
  grant: NewGrant,
  code: { challenge: string; redirectUri: string },
): Promise<string | null> {
  const admin = createAdminClient();
  const revoked = await admin
    .from("agent_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", grant.userId)
    .eq("account_id", grant.accountId)
    .eq("client_id", grant.clientId)
    .is("revoked_at", null);
  if (revoked.error) {
    console.error("[agent] replacing a grant failed:", revoked.error.message);
    return null;
  }

  const { data, error } = await admin
    .from("agent_grants")
    .insert({
      user_id: grant.userId,
      account_id: grant.accountId,
      client_id: grant.clientId,
      scopes: grant.scopes,
      resource: grant.resource,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[agent] creating a grant failed:", error.message);
    return null;
  }

  const plain = randomCredential(AUTH_CODE_PREFIX);
  const saved = await admin.from("agent_auth_codes").insert({
    code_hash: await sha256Hex(plain),
    grant_id: data.id,
    code_challenge: code.challenge,
    redirect_uri: code.redirectUri,
    expires_at: secondsFromNow(AUTH_CODE_SECONDS),
  });
  if (saved.error) {
    console.error("[agent] saving a code failed:", saved.error.message);
    return null;
  }
  return plain;
}

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

async function issueTokens(grantId: string, scopes: readonly string[]): Promise<TokenPair | null> {
  const accessToken = randomCredential(ACCESS_TOKEN_PREFIX);
  const refreshToken = randomCredential(REFRESH_TOKEN_PREFIX);
  const { error } = await createAdminClient().from("agent_tokens").insert([
    {
      token_hash: await sha256Hex(accessToken),
      grant_id: grantId,
      kind: "access",
      expires_at: secondsFromNow(ACCESS_TOKEN_SECONDS),
    },
    {
      token_hash: await sha256Hex(refreshToken),
      grant_id: grantId,
      kind: "refresh",
      expires_at: secondsFromNow(REFRESH_TOKEN_SECONDS),
    },
  ]);
  if (error) {
    console.error("[agent] issuing tokens failed:", error.message);
    return null;
  }
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_SECONDS, scope: scopes.join(" ") };
}

export type ExchangeResult =
  | { ok: true; tokens: TokenPair }
  | { ok: false; error: "invalid_grant" | "server_error"; description: string };

const INVALID_CODE: ExchangeResult = {
  ok: false,
  error: "invalid_grant",
  description: "The authorization code is invalid, expired or already used.",
};

/**
 * Trade a code for tokens. The code is spent FIRST, in one conditional update,
 * so two racing exchanges cannot both win. A code used twice means someone else
 * has it, and OAuth says to treat what it minted as compromised: the grant goes.
 */
export async function exchangeAuthCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<ExchangeResult> {
  const admin = createAdminClient();
  const codeHash = await sha256Hex(input.code);
  const { data: code, error } = await admin
    .from("agent_auth_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("grant_id, code_challenge, redirect_uri")
    .maybeSingle();
  if (error) {
    console.error("[agent] spending a code failed:", error.message);
    return { ok: false, error: "server_error", description: "Please try again." };
  }
  if (!code) {
    const { data: spent } = await admin
      .from("agent_auth_codes")
      .select("grant_id, used_at")
      .eq("code_hash", codeHash)
      .maybeSingle();
    if (spent?.used_at) await revokeGrantById(spent.grant_id);
    return INVALID_CODE;
  }

  const { data: grant } = await admin
    .from("agent_grants")
    .select("id, client_id, scopes, revoked_at")
    .eq("id", code.grant_id)
    .maybeSingle();
  if (!grant || grant.revoked_at || grant.client_id !== input.clientId) return INVALID_CODE;
  if (!redirectUriMatches(input.redirectUri, [code.redirect_uri])) return INVALID_CODE;
  if ((await pkceChallenge(input.codeVerifier)) !== code.code_challenge) return INVALID_CODE;

  const tokens = await issueTokens(grant.id, grant.scopes);
  if (!tokens) return { ok: false, error: "server_error", description: "Please try again." };
  return { ok: true, tokens };
}

/**
 * Rotate a refresh token. Spent in one conditional update like a code. A token
 * spent twice means two parties hold it: the whole connection is revoked, and
 * the seller's next use asks them to approve again. A second try within a few
 * seconds is let off, because that is what a client retrying a lost response
 * looks like, and revoking for it would disconnect people at random.
 */
export async function rotateRefreshToken(input: {
  refreshToken: string;
  clientId: string;
}): Promise<ExchangeResult> {
  const admin = createAdminClient();
  const invalid: ExchangeResult = {
    ok: false,
    error: "invalid_grant",
    description: "The refresh token is invalid, expired or already used.",
  };
  const tokenHash = await sha256Hex(input.refreshToken);
  const now = new Date().toISOString();
  const { data: token, error } = await admin
    .from("agent_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .eq("kind", "refresh")
    .is("used_at", null)
    .gt("expires_at", now)
    .select("grant_id")
    .maybeSingle();
  if (error) {
    console.error("[agent] spending a refresh token failed:", error.message);
    return { ok: false, error: "server_error", description: "Please try again." };
  }
  if (!token) {
    const { data: spent } = await admin
      .from("agent_tokens")
      .select("grant_id, used_at")
      .eq("token_hash", tokenHash)
      .eq("kind", "refresh")
      .maybeSingle();
    if (spent?.used_at && Date.now() - Date.parse(spent.used_at) > REFRESH_RETRY_GRACE_MS) {
      await revokeGrantById(spent.grant_id);
    }
    return invalid;
  }

  const { data: grant } = await admin
    .from("agent_grants")
    .select("id, client_id, scopes, revoked_at")
    .eq("id", token.grant_id)
    .maybeSingle();
  if (!grant || grant.revoked_at || grant.client_id !== input.clientId) return invalid;

  const tokens = await issueTokens(grant.id, grant.scopes);
  if (!tokens) return { ok: false, error: "server_error", description: "Please try again." };
  return { ok: true, tokens };
}

export type LiveGrant = {
  id: string;
  userId: string;
  accountId: string;
  clientId: string;
  scopes: AgentScope[];
  resource: string;
};

/** The live grant behind an access token, or null. Reads the grant every time,
 *  so a revocation takes effect on the very next call. */
export async function grantForAccessToken(accessToken: string): Promise<LiveGrant | null> {
  const admin = createAdminClient();
  const { data: token, error } = await admin
    .from("agent_tokens")
    .select("grant_id, expires_at")
    .eq("token_hash", await sha256Hex(accessToken))
    .eq("kind", "access")
    .maybeSingle();
  if (error) throw new Error(`Reading an agent token failed: ${error.message}`);
  if (!token || Date.parse(token.expires_at) <= Date.now()) return null;

  const { data: grant, error: grantError } = await admin
    .from("agent_grants")
    .select("id, user_id, account_id, client_id, scopes, resource, revoked_at, last_used_at")
    .eq("id", token.grant_id)
    .maybeSingle();
  if (grantError) throw new Error(`Reading an agent grant failed: ${grantError.message}`);
  if (!grant || grant.revoked_at) return null;

  if (!grant.last_used_at || Date.now() - Date.parse(grant.last_used_at) > LAST_USED_WRITE_MS) {
    const touched = await admin
      .from("agent_grants")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", grant.id);
    if (touched.error) console.warn("[agent] last-used write failed:", touched.error.message);
  }

  return {
    id: grant.id,
    userId: grant.user_id,
    accountId: grant.account_id,
    clientId: grant.client_id,
    scopes: knownScopes(grant.scopes),
    resource: grant.resource,
  };
}

/** Drop a token (RFC 7009). A refresh token takes its whole grant with it. */
export async function revokeToken(token: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("agent_tokens")
    .select("grant_id, kind")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (!data) return;
  if (data.kind === "refresh") await revokeGrantById(data.grant_id);
  else await admin.from("agent_tokens").delete().eq("token_hash", await sha256Hex(token));
}

async function revokeGrantById(grantId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("agent_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null);
  if (error) console.error("[agent] revoking a grant failed:", error.message);
}

/** The person's own revoke. Filters on them: a grant id alone proves nothing. */
export async function revokeGrantForUser(grantId: string, userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("agent_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[agent] revoking a grant failed:", error.message);
    return false;
  }
  return data !== null;
}

export type ConnectedApp = {
  grantId: string;
  appName: string;
  /** Where its approval was sent: the one part of an app's identity it cannot
   *  simply claim. */
  redirectUris: string[];
  accountId: string;
  scopes: AgentScope[];
  createdAt: string;
  lastUsedAt: string | null;
};

/** The person's live connections, newest first, for Settings. */
export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_grants")
    .select("id, client_id, account_id, scopes, created_at, last_used_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Reading connected apps failed: ${error.message}`);
  if (!data.length) return [];

  const { data: clients, error: clientsError } = await admin
    .from("agent_clients")
    .select("id, name, redirect_uris")
    .in("id", [...new Set(data.map((grant) => grant.client_id))]);
  if (clientsError) throw new Error(`Reading connected apps failed: ${clientsError.message}`);
  const byId = new Map(clients.map((client) => [client.id, client]));

  return data.map((grant) => {
    const client = byId.get(grant.client_id);
    return {
      grantId: grant.id,
      appName: client?.name ?? grant.client_id,
      redirectUris: client?.redirect_uris ?? [],
      accountId: grant.account_id,
      scopes: knownScopes(grant.scopes),
      createdAt: grant.created_at,
      lastUsedAt: grant.last_used_at,
    };
  });
}

/** Record one tool call. Best-effort: a trail must not fail the work it records. */
export async function recordToolCall(entry: {
  grantId: string;
  accountId: string;
  tool: string;
  outcome: string;
}): Promise<void> {
  const { error } = await createAdminClient().from("agent_audit_log").insert({
    grant_id: entry.grantId,
    account_id: entry.accountId,
    tool: entry.tool,
    outcome: entry.outcome,
  });
  if (error) console.warn("[agent] audit write failed:", error.message);
}
