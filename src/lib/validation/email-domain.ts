// SERVER ONLY. Does this email domain accept mail at all?
//
// The last check available without sending anything. The sync filters in
// ./email-quality.ts catch placeholders and throwaway providers; this catches
// the other common way a contact address is dead — a domain that was mistyped
// ("gmial.com"), never registered, or registered but never given a mail host.
//
// WHY DNS-OVER-HTTPS. This runs on Cloudflare Workers, which has no
// `node:dns` and no outbound UDP, so a resolver library is not an option. DoH
// is a plain HTTPS GET, works identically in `next dev` and on the edge, and
// asks a public resolver a question about a domain the seller has just typed
// in public-facing settings. Nothing about the person is sent — the query is
// the domain, never the local part, and never the address.
//
// FAIL-OPEN, DELIBERATELY, AND ONLY HERE. Every other part of the publish gate
// fails closed. This one does not, because it depends on a third party being
// reachable: refusing a seller's real address because a resolver timed out
// would block a legitimate save for a reason the seller cannot see, act on, or
// retry their way out of. A "no" is only ever returned on an ANSWERED query
// that says the domain has no route for mail. Everything else — timeout,
// non-200, malformed JSON, SERVFAIL — is "unknown", and unknown is accepted.

/** Cloudflare's public resolver, JSON API. */
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** Long enough for a cold resolver, short enough not to hang a form save. */
const DOH_TIMEOUT_MS = 2500;

/** DNS RCODEs this cares about: 0 NOERROR, 3 NXDOMAIN. */
const RCODE_NOERROR = 0;
const RCODE_NXDOMAIN = 3;

export type MailDomainVerdict = "yes" | "no" | "unknown";

type DohAnswer = { type?: number; data?: string };
type DohResponse = { Status?: number; Answer?: DohAnswer[] };

async function query(name: string, type: "MX" | "A" | "AAAA"): Promise<DohResponse | null> {
  try {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
      // A domain's mail setup does not change between two keystrokes, and this
      // is asked once per settings save.
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as DohResponse;
  } catch {
    // Timeout, DNS of the resolver itself, offline dev machine, malformed JSON.
    return null;
  }
}

/** The domain half of an address already known to be shaped like one. */
function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * Can mail be delivered to this address's domain?
 *
 * "no" ONLY when the resolver answered and the answer rules it out: the domain
 * does not exist (NXDOMAIN), or it exists with no MX and no address record to
 * fall back on. That fallback matters — a domain with an A record and no MX is
 * still a valid mail destination under RFC 5321 §5.1, and plenty of small
 * domains are set up exactly that way.
 */
export async function hasMailExchanger(email: string): Promise<MailDomainVerdict> {
  const domain = domainOf(email);
  // Nothing to ask about. The format check and the placeholder filter own this
  // case; there is no useful DNS question here.
  if (!domain || !domain.includes(".")) return "unknown";

  const mx = await query(domain, "MX");
  if (!mx) return "unknown";
  if (mx.Status === RCODE_NXDOMAIN) return "no";
  if (mx.Status !== RCODE_NOERROR) return "unknown";
  // Type 15 is MX. A CNAME in the chain arrives as an answer of another type,
  // so the record type is checked rather than the answer count.
  if (mx.Answer?.some((answer) => answer.type === 15 && answer.data)) return "yes";

  // No MX: fall back to the implicit one, an address record on the domain.
  const [a, aaaa] = await Promise.all([query(domain, "A"), query(domain, "AAAA")]);
  if (!a && !aaaa) return "unknown";
  const hasAddress =
    a?.Answer?.some((answer) => answer.type === 1 && answer.data) ||
    aaaa?.Answer?.some((answer) => answer.type === 28 && answer.data);
  if (hasAddress) return "yes";
  // Both queries answered, neither offered anywhere to deliver to.
  if (a?.Status === RCODE_NOERROR || aaaa?.Status === RCODE_NOERROR) return "no";
  return "unknown";
}
