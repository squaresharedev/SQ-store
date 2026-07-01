import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext adapter config for Cloudflare Workers. Defaults are fine for the
// scaffold. When the dashboard needs ISR/on-demand revalidation, wire an
// incremental cache here (e.g. R2 via `@opennextjs/cloudflare/overrides/...`).
export default defineCloudflareConfig({});
