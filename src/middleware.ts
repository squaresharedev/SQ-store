import { NextResponse, type NextRequest } from "next/server";
import { REQUESTED_PATH_HEADER, isSignedInPath, requestedPathOf } from "@/lib/auth/requested-path";
import { isMalformedMultipart } from "@/lib/security/multipart-guard";

/**
 * Tells the dashboard's sign-in gate which page was asked for, so a signed-out
 * visitor is sent back to it after signing in (lib/auth/requested-path.ts).
 *
 * THIS FILE DECIDES NOTHING about access. It reads no cookie, calls no service
 * and never redirects: it copies the requested path into one request header,
 * always overwriting a value a client sent. Who may see a page is still
 * decided by requireUser in the server components.
 *
 * The one request it answers itself is a multipart POST no parser could read
 * (lib/security/multipart-guard.ts): a 400 here instead of an unhandled 500
 * inside Next's Server Action handler.
 *
 * WHY middleware.ts AND NOT proxy.ts. Next 16 renamed this file to proxy.ts and
 * runs a proxy on the Node.js runtime only, and @opennextjs/cloudflare refuses
 * to build a Node middleware ("Node.js middleware is not currently
 * supported"). The deprecated middleware.ts still runs on the Edge runtime,
 * which OpenNext bundles into the Worker. Move to proxy.ts when OpenNext
 * supports Node middleware.
 *
 * MATCHER: the signed-in dashboard, kept literal because Next reads it
 * statically. It mirrors SIGNED_IN_PREFIXES (tests/unit/requested-path.test.ts
 * compares them). Besides those, only multipart requests to a page anywhere
 * (never the API, whose handlers parse their own bodies, or static files);
 * every other public request never passes through here.
 */
export async function middleware(request: NextRequest) {
  if (await isMalformedMultipart(request)) {
    return new NextResponse(null, { status: 400 });
  }
  if (!isSignedInPath(request.nextUrl.pathname)) return NextResponse.next();
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
    "/oauth/authorize/:path*",
    {
      source: "/((?!api/|_next/).*)",
      has: [{ type: "header", key: "content-type", value: "multipart/form-data.*" }],
    },
  ],
};
