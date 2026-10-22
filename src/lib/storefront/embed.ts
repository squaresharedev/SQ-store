import { normalizeHostname } from "@/lib/validation/inputs";
import type { EmbedSettings } from "@/types/storefront";

/**
 * Access rules for the public embed endpoint. Pure functions, so the decisions
 * are testable without a request, a database, or a network.
 */

export type EmbedDecision =
  | { allowed: true; origin: string }
  /** `status` is what the endpoint should return; `reason` is for logs only. */
  | { allowed: false; status: 403 | 404; reason: string };

/**
 * Is this request allowed to read this storefront's embed payload?
 *
 * THREE gates, in order of what they protect:
 *
 * 1. The storefront must exist. A bad or rotated key is a 404 — the same
 *    answer as a key that never existed, so probing keys learns nothing.
 * 2. Embedding must be switched ON. The stored flag is meaningless unless it
 *    is checked HERE; the toggle in the dashboard is just what writes it.
 * 3. The requesting Origin must be on the allowlist.
 *
 * An EMPTY allowlist denies everything. That is deliberate: "no domains" is
 * the state a storefront is in before the seller has said where it may appear,
 * and defaulting that to "anywhere" would mean every newly enabled embed is
 * briefly open to the whole web. The dashboard warns when the list is empty
 * rather than quietly serving.
 *
 * A MISSING Origin header is also denied. Browsers send Origin on the
 * cross-origin requests this endpoint exists to serve; its absence means the
 * caller is not the case we are serving (curl, a server-side fetch, a crawler),
 * and those have no allowlisted origin to match.
 */
export function decideEmbedAccess(options: {
  settings: EmbedSettings | undefined;
  /** Raw `Origin` request header, or null when absent. */
  origin: string | null;
}): EmbedDecision {
  const { settings, origin } = options;

  if (!settings?.enabled) {
    return { allowed: false, status: 404, reason: "embedding disabled" };
  }
  if (settings.domains.length === 0) {
    return { allowed: false, status: 403, reason: "no allowed domains configured" };
  }
  if (!origin) {
    return { allowed: false, status: 403, reason: "no Origin header" };
  }

  const parsed = parseOrigin(origin);
  if (!parsed) {
    return { allowed: false, status: 403, reason: "unparsable Origin" };
  }
  if (!embedDomainsInclude(settings.domains, parsed.host)) {
    return { allowed: false, status: 403, reason: "origin not allowed" };
  }
  // The CANONICAL origin, rebuilt from the parse — never the raw header.
  // We match on the parsed host, so echoing the raw string back would put an
  // attacker-influenced value into a response header on the strength of a
  // check that was performed on something else. A real browser's Origin
  // round-trips through this unchanged; a malformed one comes out normalized
  // and simply fails the browser's own CORS comparison.
  return { allowed: true, origin: parsed.origin };
}

/** A site's name without a leading "www.", for comparing two spellings of it. */
function withoutWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * Is this hostname one of the listed sites?
 *
 * Whole-host match only. No suffix matching: allowing "example.com" to cover
 * "evil-example.com" (or any attacker-registered "*example.com") is the
 * classic allowlist bug, and subdomains are listed explicitly instead.
 *
 * ONE EXCEPTION: a leading "www." is ignored on both sides. "example.com" and
 * "www.example.com" are one site to the person who owns it, and they answer
 * to the same owner in DNS, so a seller who typed one is not refused on the
 * other. That is the single most common reason an embed "does not show".
 */
export function embedDomainsInclude(domains: readonly string[], hostname: string): boolean {
  const wanted = withoutWww(hostname);
  return domains.some((domain) => withoutWww(domain) === wanted);
}

/**
 * The frame a SITE BUILDER puts pasted code in, for one of the seller's sites.
 *
 * Some builders never place a seller's HTML on the page itself: they serve it
 * from a host of their own, in a frame, so the embed sits one or two frames
 * down and every one of those hosts has to be in its `frame-ancestors`. These
 * are the ones we know to recognise, each as narrow as its builder allows:
 *
 * - WIX serves an HTML element from the site's own host with its dots turned
 *   to dashes, under filesusr.com: www.shop.com's is www-shop-com.filesusr.com,
 *   shop.wixsite.com's is shop-wixsite-com.filesusr.com. Derived from a listed
 *   site, so it admits that seller's wrapper and no one else's.
 * - GOOGLE SITES serves embed code from a per-embed host under
 *   googleusercontent.com (`<id>-atari-embeds`), sometimes through Google's
 *   own www.gstatic.com. The id cannot be derived from anything, so any such
 *   host is admitted.
 *
 * WHAT THE GOOGLE CASE COSTS, stated so nobody has to rediscover it:
 * `frame-ancestors` is a set, and anyone can make a Google Site. So someone
 * could open their own atari-embeds page directly and show a seller's board
 * on it. They gain nothing a visitor to the seller's site does not already
 * see: the board is public, and a click only opens the product's own page in a
 * new tab. What it cannot do is put the board on their OWN site: the top page
 * is always above the frame, and only the seller's sites are listed.
 */
function isBuilderFrame(domains: readonly string[], hostname: string): boolean {
  if (GOOGLE_SITES_FRAME.test(hostname) || hostname === GOOGLE_STATIC_HOST) return true;
  if (!hostname.endsWith(WIX_FRAME_SUFFIX)) return false;
  const label = hostname.slice(0, -WIX_FRAME_SUFFIX.length);
  return domains.some((domain) => {
    const bare = withoutWww(domain);
    return [bare, `www.${bare}`].some((host) => host.replaceAll(".", "-") === label);
  });
}

/** Where Wix serves a site's HTML elements (see isBuilderFrame). */
const WIX_FRAME_SUFFIX = ".filesusr.com";
/** Where Google Sites serves embed code (see isBuilderFrame). */
const GOOGLE_SITES_FRAME = /^[a-z0-9-]+-atari-embeds\.googleusercontent\.com$/;
const GOOGLE_STATIC_HOST = "www.gstatic.com";

/**
 * May this storefront's embed frame be drawn under these sites? The frame's
 * form of decideEmbedAccess, asked about the hostnames the browser has been
 * told to enforce (every page above the frame must be one of them) rather than
 * an Origin header.
 *
 * Embedding must be switched on; EVERY name must be one of the seller's sites
 * or a site builder's frame for one (isBuilderFrame); and at least one must be
 * the seller's own, so a list of builder frames alone is never enough.
 */
export function areEmbedSitesAllowed(settings: EmbedSettings | undefined, hostnames: readonly string[]): boolean {
  if (!settings?.enabled || hostnames.length === 0) return false;
  let listed = false;
  for (const hostname of hostnames) {
    if (embedDomainsInclude(settings.domains, hostname)) listed = true;
    else if (!isBuilderFrame(settings.domains, hostname)) return false;
  }
  return listed;
}

/** Canonical `{ origin, host }` for an http(s) Origin header, or null. */
function parseOrigin(value: string): { origin: string; host: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { origin: url.origin, host: normalizeHostname(url.hostname) };
  } catch {
    return null;
  }
}

/**
 * The hostname of an Origin header, or null if it isn't a usable one.
 *
 * Parsed with the URL parser rather than string-matched, for the same reason
 * the redirect guard is: a browser resolves "https://a.com\\@evil.com" by its
 * own rules, not by ours. Only http/https are accepted, so "null",
 * "file://…" and any exotic scheme are refused rather than coerced.
 */
export function originHostname(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Lowercased and scheme/port-free, to compare against stored bare hosts.
    return normalizeHostname(url.hostname);
  } catch {
    return null;
  }
}

/**
 * CORS headers for an ALLOWED origin.
 *
 * The origin is echoed rather than `*` because `*` would let any site read the
 * response, which is precisely what the allowlist forbids. `Vary: Origin` is
 * mandatory with an echoed origin: without it a shared cache could serve one
 * site's allowed response to another site's request.
 */
export function embedCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    // No credentials: the payload is public-by-configuration, and allowing
    // them would make the echoed origin a far more dangerous mistake.
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
}

