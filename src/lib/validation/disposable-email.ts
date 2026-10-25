/**
 * Blocklist of throwaway/temp-mail providers (Mailinator, YOPmail,
 * 10minutemail, and thousands more), maintained upstream at
 * github.com/disposable-email-domains/disposable-email-domains and updated via
 * `pnpm update disposable-email-domains` rather than hand-rolled here — the
 * whole point is coverage, and a list someone has to remember to add to would
 * only ever cover what we personally happened to notice.
 *
 * WHAT THIS COSTS ON A WORKER, AND WHY IT IS WRITTEN THIS WAY. The list is
 * about 120,000 strings, and a Worker isolate dies past 128 MB of heap (the
 * visitor sees Cloudflare's Error 1102, and no app code runs to report it).
 * Three things used to put roughly 20 MB of it on every isolate, signed in or
 * not, because the shared email checks load this module:
 *   - `import list from "disposable-email-domains"` goes through the bundler's
 *     ESM interop, which gives an array one getter PER ENTRY (about 15 MB);
 *   - copying it into a Set held a second 120,000-entry structure;
 *   - both ran when the module was first imported, whether or not anyone was
 *     signing up.
 * So: a plain `require` (no interop, the array itself), on the first check
 * only, searched in place. The list is sorted (a test holds that), so a binary
 * search is a few comparisons and needs no second copy.
 */
let domains: readonly string[] | null = null;

function listedDomains(): readonly string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above: an import would pay the interop.
  return (domains ??= require("disposable-email-domains") as readonly string[]);
}

/** Is `domain` itself on the (sorted) list? */
function isListed(domain: string): boolean {
  const list = listedDomains();
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const entry = list[mid];
    if (entry === domain) return true;
    if (entry < domain) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

/**
 * Extract the domain from an address already known to be shaped like one
 * (see `emailAddress` in inputs.ts, which every caller runs first). Falls
 * back to the empty string rather than throwing, so a malformed address is
 * simply "not disposable" and left for the format check to reject.
 */
function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * Is this address's domain a known disposable/temp-mail provider?
 *
 * Checked as the domain itself AND as every parent of it ("sub.mailinator.com"
 * for a listed "mailinator.com"): these services routinely mint throwaway
 * subdomains, and the list would otherwise need every one of them named
 * individually to be worth anything. Walking up the labels keeps each check a
 * handful of binary searches instead of scanning the whole list for a suffix.
 */
export function isDisposableEmailDomain(email: string): boolean {
  const domain = domainOf(email);
  if (!domain) return false;
  const labels = domain.split(".");
  for (let start = 0; start < labels.length - 1; start += 1) {
    if (isListed(labels.slice(start).join("."))) return true;
  }
  return false;
}
