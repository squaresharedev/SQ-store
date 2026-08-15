import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const isDev = process.env.NODE_ENV === "development";

/**
 * Origins the browser is allowed to talk to, derived from the same env var the
 * browser client reads so a preview deployment on a different Supabase project
 * does not need this file edited. Falls back to nothing rather than to a
 * wildcard: a missing URL should narrow the policy, never widen it.
 */
const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

/**
 * CONTENT SECURITY POLICY.
 *
 * WHY THERE IS NO NONCE. A per-request nonce is the strong form of this header,
 * and it is not reachable on this stack. Next.js 16 renamed `middleware.ts` to
 * `proxy.ts` and pinned Proxy to the Node runtime (the `runtime` option throws),
 * while @opennextjs/cloudflare fails the build outright on Node middleware
 * ("Node.js middleware is not currently supported"). `headers()` below is
 * evaluated once at startup, so it cannot emit a fresh random value per request.
 * That leaves 'unsafe-inline' for scripts, which Next.js needs anyway for the
 * RSC flight-data stream it inlines into every response.
 *
 * WHAT THIS STILL BUYS. The directives that do NOT need a nonce are the ones
 * that close real surface here: framing, base-tag injection, plugin content,
 * and — the valuable one — form-action and connect-src, which bound where data
 * can be sent even if script did run. The app currently has no XSS sink at all
 * (no dangerouslySetInnerHTML, innerHTML, postMessage, or eval), so the marginal
 * value of a nonce is small and the cost, a deprecated edge middleware plus the
 * loss of static optimisation, is not.
 *
 * `style-src` keeps 'unsafe-inline' regardless: app/global-error.tsx styles
 * itself with inline `style` props, and a nonce does not cover style ATTRIBUTES.
 */
/** Reporting API group name, shared by the `report-to` directive and the
 *  Reporting-Endpoints header that declares where the group points. */
const CSP_REPORT_GROUP = "csp-endpoint";

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is React's dev-time requirement only; it never ships to prod.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // blob: covers client-side image previews before an upload is committed;
  // R2 serves presigned product images, Supabase Storage serves avatars.
  `img-src 'self' data: blob: https://*.r2.cloudflarestorage.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  // next/font/local self-hosts every face, so no third-party font origin. R2
  // serves ONE more kind: a typeface the seller uploaded for their storefront,
  // fetched through a presigned URL (blob: covers the local preview of a font
  // in the moments between picking the file and saving).
  "font-src 'self' blob: https://*.r2.cloudflarestorage.com",
  // wss: is load-bearing — the notification bell holds a Supabase Realtime
  // socket, and omitting it silently kills live notifications.
  [
    "connect-src 'self'",
    supabaseOrigin,
    supabaseOrigin?.replace(/^https:/, "wss:"),
    // Turbopack's HMR socket.
    isDev ? "ws://localhost:*" : null,
  ]
    .filter(Boolean)
    .join(" "),
  // NO frame-ancestors HERE. It is ignored in a report-only policy by spec, and
  // every browser says so out loud: "the directive 'frame-ancestors' is ignored
  // when delivered in a report-only policy" was logged on every page load of
  // the app. Framing is blocked by X-Frame-Options: DENY below, which is doing
  // the actual work. Put this directive back the moment the header below is
  // renamed to the enforcing "Content-Security-Policy", where it supersedes
  // X-Frame-Options and is the stronger of the two.
  "base-uri 'self'",
  // Stops an injected form from posting a session-authenticated request offsite.
  "form-action 'self'",
  "object-src 'none'",
  // Mostly redundant next to HSTS, but HSTS only applies once the browser has
  // seen the header at least once; this covers that first visit.
  //
  // PRODUCTION ONLY. The directive upgrades ws:// to wss:// as well as http://,
  // which would break Turbopack's HMR socket on http://localhost the moment
  // this policy stops being report-only.
  isDev ? null : "upgrade-insecure-requests",
  // WITHOUT THIS THE HEADER DOES NOTHING, and browsers said as much on every
  // page load: "was delivered in report-only mode, but does not specify a
  // 'report-to'; the policy will have no effect." A report-only policy with
  // nowhere to report is not an observation period, it is an inert header —
  // so the plan below (ship observing, confirm clean, then enforce) could
  // never have produced a report to read. Names the endpoint declared in the
  // Reporting-Endpoints header alongside it.
  `report-to ${CSP_REPORT_GROUP}`,
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  // OpenNext runs the Node runtime on Workers. Never set
  // `export const runtime = "edge"` anywhere in the app.

  /**
   * SEPARATE BUILD CACHE FOR THE E2E STACK, which runs its own `next dev` on the
   * same port from the same checkout (tests/e2e/stack/server.mjs) pointed at the
   * mock gateway on 127.0.0.1:54321.
   *
   * Sharing `.next` with it is not merely untidy — NEXT_PUBLIC_* values are
   * inlined into the compiled chunks, so once a test run has compiled a route,
   * an ordinary `pnpm dev` serves that cached chunk with the TEST Supabase URL
   * baked in. It surfaces as the app talking to 127.0.0.1:54321 (Google sign-in
   * lands on the mock gateway's /auth/v1/authorize, which does not exist) with
   * a .env.local that plainly says otherwise.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Out of the toast stack's corner (bottom-right): the badge sat directly on
  // top of every confirmation in development, hiding the exact thing being
  // worked on. Dev-only; production never renders it.
  devIndicators: { position: "bottom-left" },

  // Baseline security headers on every response. The dashboard is a private,
  // session-cookie-authenticated app with no legitimate reason to be framed,
  // so denying framing closes the clickjacking surface outright. (The future
  // public embed widget is a SEPARATE origin serving its own script; it is not
  // affected by the dashboard's frame policy.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // REPORT-ONLY on purpose. This policy has never run against real
          // traffic, and an enforcing CSP that is one directive short breaks
          // the whole app for everyone at once. Ship it observing, confirm the
          // violation report is clean, then rename the key to
          // "Content-Security-Policy" to enforce.
          { key: "Content-Security-Policy-Report-Only", value: csp },
          // Where the policy's `report-to` group actually goes. Same origin, so
          // no CORS preflight and no third-party collector in the loop.
          {
            key: "Reporting-Endpoints",
            value: `${CSP_REPORT_GROUP}="/api/csp-report"`,
          },
          // THE ONLY THING BLOCKING FRAMING TODAY. It used to be described as
          // the legacy fallback behind CSP frame-ancestors, but that directive
          // is inert in a report-only policy (see the CSP above), so this
          // header has been carrying the clickjacking defence alone all along.
          { key: "X-Frame-Options", value: "DENY" },
          // Browsers must not MIME-sniff responses into executable types.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Cross-origin requests learn the origin, never the full URL
          // (dashboard URLs carry ids worth keeping private).
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Two years, subdomains included. The cookie is scoped to
          // .squareshare.eu, so a single plaintext sibling would be enough to
          // leak it; HSTS is what forecloses that.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

// Make Cloudflare bindings/env available during `next dev` so local development
// mirrors the Workers runtime. No-op for production builds.
initOpenNextCloudflareForDev();
