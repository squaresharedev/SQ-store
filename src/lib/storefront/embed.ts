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
 * May this storefront's embed frame be drawn on this site? The frame's form of
 * decideEmbedAccess: same two rules (switched on, and listed), asked about a
 * hostname the browser has been told to enforce rather than an Origin header.
 */
export function isEmbedSiteAllowed(settings: EmbedSettings | undefined, hostname: string): boolean {
  return Boolean(settings?.enabled) && embedDomainsInclude(settings?.domains ?? [], hostname);
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

