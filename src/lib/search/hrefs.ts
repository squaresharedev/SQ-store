/**
 * Where a search result lands, for the types whose destination is not simply
 * "the page that owns it". One module so the live API route and the snapshot
 * (which build the same results from different sources) cannot drift.
 */

/**
 * An order result opens the LIST, with that order's row highlighted — never
 * its detail panel.
 *
 * Landing straight in the panel drops the user into a modal over a list they
 * never saw: nothing shows which row it came from, and closing it leaves them
 * somewhere they did not choose to be. Highlighting instead shows the order in
 * context and leaves opening it as the user's move, which is also what makes
 * "that's not the one" recoverable in a glance rather than a close-and-retry.
 *
 * `q` is what GUARANTEES there is a row to highlight. The list is paginated
 * newest-first, so an older order would otherwise sit pages deep and the
 * highlight would match nothing on screen; narrowing to the buyer puts it on
 * the first page. The orders list searches buyer_email (see listOrders), so
 * that is the only column worth passing — an order with no buyer email gets
 * the highlight alone and relies on being recent.
 */
export function orderResultHref(id: string, buyerEmail?: string | null): string {
  const params = new URLSearchParams();
  if (buyerEmail) params.set("q", buyerEmail);
  params.set("highlight", id);
  return `/orders?${params.toString()}`;
}
