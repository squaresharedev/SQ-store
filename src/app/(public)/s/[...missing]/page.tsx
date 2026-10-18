import { notFound } from "next/navigation";

/**
 * Every address under /s/ that is not one of the buyer pages: a storefront id
 * on its own (there is no hosted storefront page yet), a mistyped path, a link
 * cut short in a message.
 *
 * An address no route matches is answered by the ROOT not-found, whatever
 * route group it would have belonged to, and the root one is the seller
 * dashboard's. Matching it here and refusing it is what lets the buyer's own
 * 404 (../not-found.tsx) answer instead. The real pages are more specific than
 * a catch-all, so they are never shadowed by it.
 */
export default function MissingBuyerPage(): never {
  notFound();
}
