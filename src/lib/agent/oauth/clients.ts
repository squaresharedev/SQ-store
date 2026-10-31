import { z } from "zod";
import { randomCredential } from "@/lib/agent/oauth/crypto";
import { FETCH_USER_AGENT, isPublicHttpsUrl } from "@/lib/agent/oauth/public-url";
import {
  isAllowedRedirectUri,
  type ApplicationType,
} from "@/lib/agent/oauth/redirects";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who an app says it is. Two ways in, because MCP clients use both:
 *   - it registers itself (RFC 7591), and gets an id;
 *   - its client_id IS the HTTPS URL of a metadata document we read
 *     (Client ID Metadata Documents, the newer spec's preferred way, and what
 *     Claude does today: https://claude.ai/oauth/mcp-oauth-client-metadata).
 *
 * NEITHER PROVES ANYTHING ABOUT THE NAME. Anyone can register as "Claude",
 * which is why the consent page leads with the redirect host, the one part an
 * impostor cannot fake and still receive the code.
 */

export type AgentClient = {
  id: string;
  name: string;
  redirectUris: string[];
  applicationType: ApplicationType;
};

const CLIENT_NAME_MAX = 100;
const REDIRECT_URIS_MAX = 10;
const REDIRECT_URI_MAX = 2000;

/** The fields we read; a document may carry any others. */
const clientMetadataSchema = z.object({
  client_name: z.string().trim().min(1).max(CLIENT_NAME_MAX).optional(),
  redirect_uris: z.array(z.string().max(REDIRECT_URI_MAX)).min(1).max(REDIRECT_URIS_MAX),
  application_type: z.enum(["web", "native"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

export type RegisterError = { error: "invalid_client_metadata" | "invalid_redirect_uri"; description: string };

/** Judge a registration request or a metadata document. */
export function parseClientMetadata(
  raw: unknown,
): { ok: true; name: string; redirectUris: string[]; applicationType: ApplicationType } | ({ ok: false } & RegisterError) {
  const parsed = clientMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid_client_metadata", description: "redirect_uris is required, and client_name must be short text." };
  }
  // token_endpoint_auth_method is read and ignored: every app here is a public
  // client with PKCE, and the registration answer says "none", which RFC 7591
  // lets a server do. Refusing would only turn away clients that default to a
  // secret and would happily go without one.
  const { client_name, redirect_uris, application_type, grant_types, response_types } = parsed.data;
  if (grant_types && !grant_types.includes("authorization_code")) {
    return { ok: false, error: "invalid_client_metadata", description: "grant_types must include authorization_code." };
  }
  if (response_types && !response_types.includes("code")) {
    return { ok: false, error: "invalid_client_metadata", description: "response_types must include code." };
  }
  // Claude and most desktop clients send no application_type; a non-web scheme
  // is what marks a native app in that case.
  const applicationType: ApplicationType =
    application_type ??
    (redirect_uris.every((uri) => /^https?:/i.test(uri)) ? "web" : "native");
  const bad = redirect_uris.find((uri) => !isAllowedRedirectUri(uri, applicationType));
  if (bad) {
    return { ok: false, error: "invalid_redirect_uri", description: "A redirect URI must be HTTPS, a local listener, or a native app's own scheme." };
  }
  return { ok: true, name: client_name ?? "Unnamed app", redirectUris: redirect_uris, applicationType };
}

/** Store a self-registered app and hand back its id. */
export async function registerClient(metadata: {
  name: string;
  redirectUris: string[];
  applicationType: ApplicationType;
}): Promise<AgentClient | null> {
  const id = randomCredential("app_");
  const { error } = await createAdminClient().from("agent_clients").insert({
    id,
    kind: "registered",
    name: metadata.name,
    redirect_uris: metadata.redirectUris,
    application_type: metadata.applicationType,
  });
  if (error) {
    console.error("[agent] client registration failed:", error.message);
    return null;
  }
  return { id, ...metadata };
}

/** A metadata document is re-read after this long, in case the app changed. */
const METADATA_REFRESH_MS = 24 * 60 * 60 * 1000;
const METADATA_FETCH_TIMEOUT_MS = 3000;
const METADATA_MAX_BYTES = 16 * 1024;

/** Whether a client_id is a metadata document's URL rather than a stored id. */
export function isMetadataClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

/** A metadata document's address: public, and with a path, as the spec requires
 *  (a bare origin is not a document), and no fragment. */
function isMetadataDocumentUrl(clientId: string): boolean {
  if (!isPublicHttpsUrl(clientId)) return false;
  const url = new URL(clientId);
  return url.pathname !== "/" && url.pathname !== "" && !url.hash;
}

async function fetchClientMetadata(clientId: string): Promise<AgentClient | null> {
  if (!isMetadataDocumentUrl(clientId)) return null;
  let text: string;
  try {
    // "manual", never "error": a Worker throws on "error" ("does not make sense
    // at the edge"). A redirect then comes back as a 3xx, which is refused below,
    // because a document has to answer at the URL that names it.
    const response = await fetch(clientId, {
      redirect: "manual",
      signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": FETCH_USER_AGENT },
    });
    if (response.status !== 200) {
      console.warn(`[agent] client metadata answered ${response.status}: ${clientId}`);
      return null;
    }
    text = await response.text();
    if (text.length > METADATA_MAX_BYTES) return null;
  } catch (error) {
    // Logged: "unknown app" is all the seller sees, and this is the only trace of why.
    console.warn(`[agent] client metadata fetch failed: ${clientId}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  // The document must name itself: this is what ties it to the URL.
  if ((document as { client_id?: unknown })?.client_id !== clientId) return null;
  const parsed = parseClientMetadata(document);
  if (!parsed.ok) return null;
  return {
    id: clientId,
    name: parsed.name,
    redirectUris: parsed.redirectUris,
    applicationType: parsed.applicationType,
  };
}

/**
 * The app behind a client_id, or null when there is none. A metadata-document
 * app is read from its URL and kept, and read again once the copy is old; if
 * that re-read fails, the copy still answers, so an app's brief outage does not
 * stop a seller connecting it.
 */
export async function resolveClient(clientId: string): Promise<AgentClient | null> {
  if (!clientId || clientId.length > REDIRECT_URI_MAX) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_clients")
    .select("id, name, redirect_uris, application_type, fetched_at")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    console.error("[agent] client read failed:", error.message);
    return null;
  }
  const stored: AgentClient | null = data
    ? {
        id: data.id,
        name: data.name,
        redirectUris: data.redirect_uris,
        applicationType: data.application_type === "native" ? "native" : "web",
      }
    : null;

  if (!isMetadataClientId(clientId)) return stored;
  const fresh = data?.fetched_at && Date.now() - Date.parse(data.fetched_at) < METADATA_REFRESH_MS;
  if (stored && fresh) return stored;

  const fetched = await fetchClientMetadata(clientId);
  if (!fetched) return stored;
  const { error: saveError } = await admin.from("agent_clients").upsert({
    id: fetched.id,
    kind: "metadata",
    name: fetched.name,
    redirect_uris: fetched.redirectUris,
    application_type: fetched.applicationType,
    fetched_at: new Date().toISOString(),
  });
  if (saveError) console.error("[agent] client metadata save failed:", saveError.message);
  return fetched;
}
