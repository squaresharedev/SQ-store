import { isDisposableEmailDomain } from "@/lib/validation/disposable-email";

/**
 * "Is this address plausibly a real one someone reads?" — the checks that cost
 * nothing and need no network.
 *
 * SEPARATE FROM FORMAT ON PURPOSE. `emailAddress` (inputs.ts) answers whether
 * a string is shaped like an address; this answers whether it is one worth
 * showing a buyer. "asdf@asdf.com" passes every syntax rule ever written and
 * is still a dead end for the person trying to ask about their order, which is
 * the only thing the seller's contact address exists to prevent.
 *
 * WHAT IT DOES NOT DO. Nothing here proves the mailbox exists, and nothing
 * here can: only sending mail to it and having someone click a link does that.
 * These are filters against the two things that actually happen in practice —
 * a placeholder typed to get past a required field, and a throwaway inbox — not
 * a claim of deliverability. {@link hasMailExchanger} in ./email-domain.ts adds
 * the one further check that does not need mail transport (does the domain
 * accept mail at all).
 */

/**
 * TLDs reserved by RFC 2606 / RFC 6761 for documentation, testing and local
 * use. No mail ever leaves the building for one of these, so an address ending
 * in one is a placeholder by definition rather than by suspicion.
 */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);

/**
 * Second-level domains reserved for documentation (RFC 2606) plus the handful
 * that are used as placeholders so routinely that they may as well be. `.eu`
 * and other real registries are NOT listed: a real business does live at
 * example.eu.
 */
const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "email.com",
  "test.com",
  "test.net",
  "test.org",
  "domain.com",
  "yourdomain.com",
  "mydomain.com",
  "yoursite.com",
  "mysite.com",
  "website.com",
  "yourshop.example",
  "sample.com",
  "asdf.com",
  "aaa.com",
  "abc.com",
  "none.com",
  "nomail.com",
  "noemail.com",
  "fake.com",
]);

/**
 * Local parts that mean "I am not telling you". Matched EXACTLY, never as a
 * substring: "test" is a placeholder, "testudo@…" is somebody's name, and
 * "no-reply@" is a real convention this deliberately refuses (a seller's
 * published contact address must accept a reply — that is the whole point of
 * publishing it).
 */
const PLACEHOLDER_LOCAL_PARTS = new Set([
  "test",
  "tests",
  "testing",
  "test1",
  "test123",
  "asdf",
  "asd",
  "qwerty",
  "abc",
  "aaa",
  "xxx",
  "example",
  "none",
  "null",
  "nil",
  "na",
  "n/a",
  "nobody",
  "noone",
  "fake",
  "dummy",
  "placeholder",
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "dontreply",
  "unsubscribe",
]);

/** The two halves of an address already known to be shaped like one. */
function splitEmail(email: string): { local: string; domain: string } {
  const at = email.lastIndexOf("@");
  if (at === -1) return { local: "", domain: "" };
  return {
    local: email.slice(0, at).trim().toLowerCase(),
    domain: email.slice(at + 1).trim().toLowerCase(),
  };
}

/** Does this domain sit under a reserved or placeholder name? */
function isPlaceholderDomain(domain: string): boolean {
  if (!domain) return false;
  const labels = domain.split(".");
  const tld = labels[labels.length - 1];
  if (RESERVED_TLDS.has(tld)) return true;
  // Walk the parents, so "mail.example.com" is caught alongside "example.com".
  for (let start = 0; start < labels.length - 1; start += 1) {
    if (PLACEHOLDER_DOMAINS.has(labels.slice(start).join("."))) return true;
  }
  // A bare "asdf" with no dot at all cannot resolve anywhere.
  return labels.length < 2;
}

/** An address nobody will ever read at the other end. */
export function isPlaceholderEmail(email: string): boolean {
  const { local, domain } = splitEmail(email);
  if (isPlaceholderDomain(domain)) return true;
  if (PLACEHOLDER_LOCAL_PARTS.has(local)) return true;
  // "a@b.co", "x@yz.com": a single-character local part on a single-character
  // domain label is somebody mashing the keyboard, not an address.
  const secondLevel = domain.split(".").slice(-2)[0] ?? "";
  if (local.length <= 1 && secondLevel.length <= 2) return true;
  return false;
}

/**
 * The one sync verdict for an address a real person is expected to reach: null
 * to accept, or the message to show. `label` names the field ("Your contact
 * email"), so the same function speaks for sign-up and for seller details.
 *
 * Assumes the FORMAT has already been checked — every caller runs
 * `emailAddress` first, and a malformed string is that check's to reject.
 */
export function emailQualityProblem(email: string, label: string): string | null {
  if (isPlaceholderEmail(email)) {
    return `${label} looks like a placeholder. Use an address you actually read.`;
  }
  if (isDisposableEmailDomain(email)) {
    return `${label} is at a temporary-mail provider. Use a permanent address.`;
  }
  return null;
}
