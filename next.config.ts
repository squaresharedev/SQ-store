import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // OpenNext runs the Node runtime on Workers. Never set
  // `export const runtime = "edge"` anywhere in the app.
};

export default nextConfig;

// Make Cloudflare bindings/env available during `next dev` so local development
// mirrors the Workers runtime. No-op for production builds.
initOpenNextCloudflareForDev();
