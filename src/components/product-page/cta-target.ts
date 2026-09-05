// Where the buy button goes, decided from validated data only. A plain module
// (no "use client") because the SERVER page decides this and the client button
// merely renders it: a function exported from a client module cannot be called
// during a server render.

export type CtaTarget =
  | { kind: "link"; href: string; host: string }
  // `email` and `productTitle` ride along so the CLIENT can rebuild the href
  // once it knows which version is being looked at (see mailtoHref). Neither is
  // new on the wire: the address is already inside the mailto, and the title is
  // the page's own heading.
  | { kind: "mail"; href: string; email: string; productTitle: string }
  | { kind: "none" };

/**
 * The enquiry email, WITH THE VERSION THE BUYER IS LOOKING AT written into it.
 *
 * Until in-house checkout ships this button is the only route from a buyer to
 * a seller that we control, so it is the only place the choice can be handed
 * over. A message saying "Question about Oak dining table" from someone
 * standing on the six-seater leaves the seller to guess, and guessing is how
 * the wrong table gets built.
 *
 * The facts lead and the body ends on a blank line, so the buyer types under
 * them rather than around them. Nothing here claims an intent to order: the
 * button asks a question, and putting words in the buyer's mouth is not this
 * function's business.
 */
export function mailtoHref(
  email: string,
  productTitle: string,
  selection: readonly { label: string; value: string }[] = [],
): string {
  const subject = encodeURIComponent(`Question about ${productTitle}`);
  if (selection.length === 0) return `mailto:${email}?subject=${subject}`;
  const body = encodeURIComponent(
    [productTitle, ...selection.map((entry) => `${entry.label}: ${entry.value}`), "", ""].join("\n"),
  );
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export function resolveCtaTarget(
  purchaseUrl: string | null,
  sellerEmail: string | undefined,
  productTitle: string,
): CtaTarget {
  if (purchaseUrl) {
    try {
      const url = new URL(purchaseUrl);
      // A seller's own checkout owns its variant choice, so nothing is appended
      // to their link: a guessed parameter is either ignored or breaks a signed
      // URL, and the buyer picks again on the far side either way.
      if (url.protocol === "https:") return { kind: "link", href: url.href, host: url.host };
    } catch {
      // A stored value that no longer parses is treated as no link at all.
    }
  }
  if (sellerEmail) {
    // The version-less href, which is what a server render can honestly build.
    return {
      kind: "mail",
      href: mailtoHref(sellerEmail, productTitle),
      email: sellerEmail,
      productTitle,
    };
  }
  return { kind: "none" };
}
