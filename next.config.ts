import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // OpenNext runs the Node runtime on Workers. Never set
  // `export const runtime = "edge"` anywhere in the app.

  // Baseline security headers on every response. The dashboard is a private,
  // session-cookie-authenticated app with no legitimate reason to be framed,
  // so denying framing closes the clickjacking surface outright. (The future
  // public embed widget is a SEPARATE origin serving its own script; it is not
  // affected by the dashboard's frame policy.)
  //
  // Deliberately NOT here: a full Content-Security-Policy. Next.js inline
  // scripts/styles need nonces or hashes to coexist with one, which is a
  // project of its own; a hasty CSP in report-nothing mode is decoration and
  // a strict one would break the app. Tracked as a follow-up.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Legacy header, still the broadest-supported framing block; CSP
          // frame-ancestors will supersede it when the CSP lands.
          { key: "X-Frame-Options", value: "DENY" },
          // Browsers must not MIME-sniff responses into executable types.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Cross-origin requests learn the origin, never the full URL
          // (dashboard URLs carry ids worth keeping private).
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

// Make Cloudflare bindings/env available during `next dev` so local development
// mirrors the Workers runtime. No-op for production builds.
initOpenNextCloudflareForDev();
