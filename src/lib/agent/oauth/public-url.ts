/** Who we say we are when fetching someone else's URL. A Worker sends no
 *  User-Agent by default, and plenty of hosts refuse a request without one. */
export const FETCH_USER_AGENT = "SquareShare/1.0 (+https://squareshare.eu)";

/**
 * Whether a URL an outsider gave us may be fetched by this server: HTTPS, a real
 * host name, no credentials. The Worker has no private network to reach; this is
 * a second line behind that, not the only one, because a URL chosen by someone
 * else and fetched by us is the shape of SSRF. Pure.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  // Any address literal: a public service has a name.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return false;
  return true;
}
