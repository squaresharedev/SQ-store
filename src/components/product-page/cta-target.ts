// Where the buy button goes, decided from validated data only. A plain module
// (no "use client") because the SERVER page decides this and the client button
// merely renders it: a function exported from a client module cannot be called
// during a server render.

export type CtaTarget =
  | { kind: "link"; href: string; host: string }
  | { kind: "mail"; href: string }
  | { kind: "none" };

export function resolveCtaTarget(
  purchaseUrl: string | null,
  sellerEmail: string | undefined,
  productTitle: string,
): CtaTarget {
  if (purchaseUrl) {
    try {
      const url = new URL(purchaseUrl);
      if (url.protocol === "https:") return { kind: "link", href: url.href, host: url.host };
    } catch {
      // A stored value that no longer parses is treated as no link at all.
    }
  }
  if (sellerEmail) {
    const subject = encodeURIComponent(`Question about ${productTitle}`);
    return { kind: "mail", href: `mailto:${sellerEmail}?subject=${subject}` };
  }
  return { kind: "none" };
}
