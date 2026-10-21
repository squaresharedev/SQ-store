/**
 * WHERE A SIGNED-OUT VISITOR WAS GOING, so sign-in can take them back there.
 *
 * A server component cannot see the address it is rendering for, so the
 * dashboard's sign-in gate (requireUser in lib/auth/session.ts) used to send
 * everyone to /login with whatever path its call site guessed: "/" from the
 * layouts, a section root from the pages. A link to one order, one product or
 * a filtered list came back as the dashboard home.
 *
 * src/middleware.ts stamps the requested path onto every request for a
 * signed-in route (REQUESTED_PATH_HEADER), and requireUser reads it back
 * through requestedReturnPath. The middleware decides NOTHING about access:
 * the gate stays in the server components, and a request the middleware did
 * not see (or a header it did not write) only ever falls back to the old
 * guess.
 *
 * Pure and edge-safe: the middleware imports it.
 */
import { safeInternalPath } from "@/lib/utils/safe-path";

/** The request header the middleware writes, overwriting any a client sent. */
export const REQUESTED_PATH_HEADER = "x-sq-requested-path";

/**
 * The signed-in areas of the dashboard, besides "/" itself. MIRRORED by the
 * literal `matcher` in src/middleware.ts (Next reads that statically, so it
 * cannot import this); tests/unit/requested-path.test.ts fails if they drift.
 */
export const SIGNED_IN_PREFIXES = [
  "/dashboard",
  "/orders",
  "/products",
  "/storefront",
  "/settings",
  "/analytics",
  "/discounts",
  "/notifications",
  "/payments",
  "/plans",
] as const;

/** Next's own cache-busting query parameter on a client navigation. */
const NEXT_INTERNAL_PARAMS = ["_rsc"];

/** Whether a pathname belongs to the signed-in dashboard. */
export function isSignedInPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    SIGNED_IN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

/** The path and query a request asked for, without Next's internal parameters. */
export function requestedPathOf(url: URL): string {
  const params = new URLSearchParams(url.search);
  for (const name of NEXT_INTERNAL_PARAMS) params.delete(name);
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

/**
 * The header's value as a place to send someone after sign-in, or null. Only a
 * same-origin path inside the signed-in dashboard qualifies: anything else
 * (another site, a public page, an API route, junk) is ignored, so even a
 * forged header can at worst pick which dashboard page a person lands on.
 */
export function returnPathFrom(headerValue: string | null | undefined): string | null {
  if (!headerValue || headerValue.length > 2048) return null;
  const safe = safeInternalPath(headerValue, "");
  if (!safe) return null;
  const pathname = safe.split(/[?#]/, 1)[0];
  return isSignedInPath(pathname) ? safe : null;
}
