// SERVER ONLY. The digest that stands in for an anonymous reporter.
//
// WHAT IT IS FOR, and only this: deduping (one open report per reporter per
// target) and nothing else. It is never shown to staff, never joined to
// anything, and cannot be reversed into an address. The staff queue shows a
// count, not a list of who.
//
// WHY IT IS BOUND TO THE TARGET. The same person reporting two listings
// produces two unrelated digests, so this column cannot be walked to assemble
// "everything this visitor reported". That is a deliberate cost: it means the
// platform cannot see a serial reporter across targets, which is a real abuse
// signal we are choosing not to collect. Per-IP rate limiting is what bounds
// that case instead, and it does so without keeping anything.
//
// WHY NOT REUSE analytics' visitorHash. It is bound to the ACCOUNT and salted
// for a different purpose, and two digests built the same way are two digests
// that can be compared. Deriving a reporter's digest so that it could be
// matched against the same person's browsing digest would turn a dedupe key
// into a surveillance join. The domain separator below is what prevents that,
// and it is the entire reason this is its own function rather than one more
// caller of that one.

/** Hex digest of a UTF-8 string. */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The salt. Prefers a dedicated secret; falls back to the service-role key,
 * which is already the strongest server-only secret this process holds and is
 * never sent to a browser.
 *
 * The fallback exists so that reporting works on a deployment where nobody
 * remembered to add an env var. A missing salt would mean unsalted digests of
 * an IP and user agent, which is a rainbow table away from being the IP
 * itself, and that is exactly what this guards against.
 */
function reporterSalt(): string {
  return (
    process.env.MODERATION_REPORTER_SALT ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  );
}

/**
 * A stable, non-reversible digest for one reporter on one target.
 *
 * Returns null when there is nothing to hash. That is the correct answer for a
 * request with no client identity: the report is still filed, it simply is not
 * deduped, because there is nothing to dedupe it by. Dropping the report
 * instead would mean losing notices from anyone behind a proxy that strips
 * client headers.
 */
export async function reporterHash(
  targetId: string,
  parts: (string | null | undefined)[],
): Promise<string | null> {
  const identity = parts.filter(Boolean).join("|");
  if (!identity) return null;
  // "report" is the domain separator: it is what stops this digest and an
  // analytics visitor digest for the same person ever being equal.
  return sha256Hex(`report|${reporterSalt()}|${targetId}|${identity}`);
}
