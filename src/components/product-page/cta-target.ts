// Where the buy button goes, decided from validated data only. A plain module
// (no "use client") because the SERVER page decides this and the client button
// merely renders it: a function exported from a client module cannot be called
// during a server render.

export type CtaTarget =
  | { kind: "link"; href: string; host: string }
  // Square Share's own checkout. The ids ride along rather than a finished
  // href because only the CLIENT knows which version and how many are chosen
  // at the moment of the click (see checkoutPath).
  | { kind: "checkout"; storefrontId: string; productId: string }
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
 *
 * The wording (`copy`) is resolved by the caller in the BUYER's language: the
 * buyer is the one sending it.
 */
export type EnquiryCopy = {
  /** The subject line, already naming the product. */
  subject: string;
  /** "Quantity: 3", for the quantity passed alongside it. */
  quantityLine: string;
};

export function mailtoHref(
  email: string,
  productTitle: string,
  copy: EnquiryCopy,
  selection: readonly { label: string; value: string }[] = [],
  /** How many the buyer had chosen. Stated only when it is more than one: an
   *  enquiry about a single item does not need a line saying so, and a seller
   *  reading "Quantity: 1" on every message stops reading the line at all. */
  quantity = 1,
): string {
  const subject = encodeURIComponent(copy.subject);
  const facts = [
    ...selection.map((entry) => `${entry.label}: ${entry.value}`),
    ...(quantity > 1 ? [copy.quantityLine] : []),
  ];
  if (facts.length === 0) return `mailto:${email}?subject=${subject}`;
  const body = encodeURIComponent([productTitle, ...facts, "", ""].join("\n"));
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

/**
 * Where the buy button goes, in order: the seller's OWN purchase link, then
 * Square Share checkout, then an enquiry email, then nowhere.
 *
 * The link wins over checkout on purpose. A per-product link is a deliberate
 * choice a seller made for that product (it sells on their own shop, or
 * through a marketplace that holds the stock), and turning on checkout must
 * not quietly override it. `checkout` is non-null only where a payment
 * provider can take the money for this seller (lib/checkout/availability.ts),
 * decided on the server and handed down as data.
 */
export function resolveCtaTarget(
  purchaseUrl: string | null,
  sellerEmail: string | undefined,
  productTitle: string,
  /** The enquiry subject, in the buyer's language (see mailtoHref). */
  enquirySubject: string,
  checkout: { storefrontId: string; productId: string } | null = null,
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
  if (checkout) return { kind: "checkout", ...checkout };
  if (sellerEmail) {
    // The version-less href, which is what a server render can honestly build.
    return {
      kind: "mail",
      href: mailtoHref(sellerEmail, productTitle, { subject: enquirySubject, quantityLine: "" }),
      email: sellerEmail,
      productTitle,
    };
  }
  return { kind: "none" };
}
