import { safeInternalPath } from "@/lib/utils/safe-path";

/** A storefront designer, and nothing longer or looser. */
const DESIGNER_PATH = /^\/storefront\/[0-9a-f-]{36}$/i;

/**
 * Where the new-product form may send a seller once the product is saved: back
 * to the storefront designer they left to create it, and nowhere else.
 *
 * `?next=` arrives in a URL, so it is untrusted twice over. It must stay on
 * this origin, which safeInternalPath settles with the browser's own parser,
 * AND it must be a designer route, so the parameter cannot turn a product save
 * into a bounce to some other in-app page (the danger zone, a sign-out) that a
 * crafted link chose. Anything else is null, and the form keeps its usual
 * destination, the products list.
 */
export function storefrontReturnPath(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const path = safeInternalPath(value, "");
  return DESIGNER_PATH.test(path) ? path : null;
}
