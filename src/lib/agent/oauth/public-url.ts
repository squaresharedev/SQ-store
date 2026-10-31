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
