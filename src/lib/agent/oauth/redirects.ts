/**
 * Which redirect URIs an app may register, and when one matches. Pure.
 *
 * The redirect is where the authorization code goes, so this is the check that
 * stands between an approval and a stranger's server.
 */

export type ApplicationType = "web" | "native";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Schemes that run or read something in the browser: never a redirect. */
const NEVER_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "about:", "vbscript:", "ftp:", "ws:", "wss:"]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/**
 * Whether an app may register this redirect URI:
 *   - HTTPS, always;
 *   - HTTP only to this machine (RFC 8252 7.3: a desktop app's local listener);
 *   - an app's own scheme (cursor://, vscode://) only for a native app.
 * Never a fragment (OAuth forbids it) and never credentials in the URL.
 */
export function isAllowedRedirectUri(uri: string, applicationType: ApplicationType): boolean {
  const url = parse(uri);
  if (!url || url.hash || url.username || url.password) return false;
  if (NEVER_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return applicationType === "native";
}

/**
 * Whether a redirect URI in a request is one the app registered. Exact, with
 * one exception RFC 8252 7.3 requires: a loopback listener picks its port when
 * it starts, so the port of a loopback URI may differ.
 */
export function redirectUriMatches(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  const url = parse(requested);
  if (!url || url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return false;
  return registered.some((candidate) => {
    const other = parse(candidate);
    return (
      other !== null &&
      other.protocol === "http:" &&
      other.hostname === url.hostname &&
      other.pathname === url.pathname &&
      other.search === url.search
    );
  });
}

/** What the consent page names as where this approval goes. */
export function redirectDisplayHost(uri: string): string {
  const url = parse(uri);
  if (!url) return uri;
  return url.host || url.protocol;
}

/** The redirect URI with the response parameters added. */
export function redirectWith(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
