import disposableDomains from "disposable-email-domains";

/**
 * Blocklist of throwaway/temp-mail providers (Mailinator, YOPmail,
 * 10minutemail, and thousands more), maintained upstream at
 * github.com/disposable-email-domains/disposable-email-domains and updated via
 * `pnpm update disposable-email-domains` rather than hand-rolled here — the
 * whole point is coverage, and a list someone has to remember to add to would
 * only ever cover what we personally happened to notice.
 *
 * A Set, not the raw array: this is checked on every signup attempt, so
 * membership needs to be O(1) rather than a 120k-entry linear scan.
 */
const DISPOSABLE_DOMAINS = new Set(disposableDomains as string[]);

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
 * individually to be worth anything. Walking up the labels keeps each check an
 * O(1) Set lookup instead of scanning the whole list for a suffix match.
 */
export function isDisposableEmailDomain(email: string): boolean {
  const domain = domainOf(email);
  if (!domain) return false;
  const labels = domain.split(".");
  for (let start = 0; start < labels.length - 1; start += 1) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(start).join("."))) return true;
  }
  return false;
}
