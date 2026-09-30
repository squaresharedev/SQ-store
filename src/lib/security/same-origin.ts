import { appOrigin } from "@/lib/app-url";

/**
 * Whether a request was sent by a page on this app's own origin.
 *
 * Server actions get this check from Next for free; a route handler does not,
 * and the public ones that change something (placing an order, withdrawing
 * from one) must not be callable from another site's page riding a buyer's
 * browser. Two signals, either of which is enough:
 *
 *   - `Sec-Fetch-Site: same-origin`, which every current browser sends and no
 *     page script can set;
 *   - an `Origin` header equal to the app's own configured origin (never the
 *     request's Host, which a client controls).
 *
 * A request with neither is refused: the pages that call these routes are
 * always a browser on our origin.
 *
 * WHAT THIS IS NOT: a defence against a script calling the route directly. A
 * non-browser client can send any header it likes, these two included. This
 * stops CROSS-SITE requests riding a buyer's browser (CSRF), and nothing more;
 * what stands between a script and these routes is everything after it (the
 * per-IP rate limits, the strict schemas, the server-side quote, Turnstile
 * where configured, and the payment provider itself).
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin === appOrigin();
}
