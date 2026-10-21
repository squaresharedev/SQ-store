import { NextResponse, type NextRequest } from "next/server";
import { REQUESTED_PATH_HEADER, requestedPathOf } from "@/lib/auth/requested-path";

/**
 * Tells the dashboard's sign-in gate which page was asked for, so a signed-out
 * visitor is sent back to it after signing in (lib/auth/requested-path.ts).
 *
 * THIS FILE DECIDES NOTHING. It reads no cookie, calls no service and never
 * redirects: it copies the requested path into one request header, always
 * overwriting a value a client sent. Who may see a page is still decided by
 * requireUser in the server components.
 *
 * WHY middleware.ts AND NOT proxy.ts. Next 16 renamed this file to proxy.ts and
 * runs a proxy on the Node.js runtime only, and @opennextjs/cloudflare refuses
 * to build a Node middleware ("Node.js middleware is not currently
 * supported"). The deprecated middleware.ts still runs on the Edge runtime,
 * which OpenNext bundles into the Worker. Move to proxy.ts when OpenNext
 * supports Node middleware.
 *
 * MATCHER: the signed-in dashboard only, and kept literal because Next reads it
 * statically. It mirrors SIGNED_IN_PREFIXES (tests/unit/requested-path.test.ts
 * compares them). Public pages (/s, /e), the embed, the API and static files
 * never pass through here.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(REQUESTED_PATH_HEADER, requestedPathOf(request.nextUrl));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/orders/:path*",
    "/products/:path*",
    "/storefront/:path*",
    "/settings/:path*",
    "/analytics/:path*",
    "/discounts/:path*",
    "/notifications/:path*",
    "/payments/:path*",
    "/plans/:path*",
  ],
};
