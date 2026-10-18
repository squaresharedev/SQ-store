// SERVER ONLY. The public read behind the storefront embed's frame,
// /e/[key]/[site]: a seller's board, drawn inside their own website.
//
// The same security model as the hosted storefront (storefront-page.ts), whose
// gate and payload this shares: a service-role read behind an application
// gate, and one `null` for every refusal, so nothing here is enumerable. A
// wrong key, a rotated key, a storefront with embedding off and a site that is
// not on its list all look the same from outside.
//
// WHAT THE FRAME ADDS TO THAT GATE:
//   - the storefront is found by its EMBED KEY, never its id: the key is what a
//     seller pasted into someone else's HTML, so it is what they can revoke;
//   - embedding is switched on for it, and <site> is on its allowlist.
//
// <site> is only a CLAIM here: it is whatever the address says. What makes it
// true is the browser, which was told (next.config.ts) to draw this response
// on that site alone. See lib/storefront/embed-frame.ts for both halves.

import { cache } from "react";
import { headers } from "next/headers";
import { embedOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAGE_BUSY, type PageBusy } from "@/lib/public/busy";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isEmbedSiteAllowed } from "@/lib/storefront/embed";
import { parseEmbedSite, type EmbedSite } from "@/lib/storefront/embed-frame";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import {
  STOREFRONT_PAGE_SELECT,
  buildStorefrontPage,
  type PublicStorefrontPageResult,
} from "@/lib/storefront/storefront-page";
import { uuidField } from "@/lib/validation/inputs";

export type EmbedFrameResult = PublicStorefrontPageResult & {
  /** The site the frame was asked for, as parsed: where its one message goes. */
  site: EmbedSite;
};

const keySchema = uuidField();

/**
 * Load a storefront's embed frame: `null` for every reason it cannot be shown,
 * PAGE_BUSY when the reason is only "not right now".
 *
 * Wrapped in React's `cache` so generateMetadata and the page body share one
 * read, and one rate-limit token, per request.
 */
export const getEmbedFrame = cache(
  async (embedKey: string, rawSite: string): Promise<EmbedFrameResult | PageBusy | null> => {
    // No embed host, no embed: this is the state it ships in.
    if (!embedOrigin()) return null;
    if (!keySchema.safeParse(embedKey).success) return null;
    // A port only where the header rule admits one (next.config.ts), so a
    // board is never served under a response that carries no frame-ancestors.
    const site = parseEmbedSite(rawSite, { allowPort: process.env.NODE_ENV === "development" });
    if (!site) return null;

    // Spent before the first read, and before the allowlist is consulted, so
    // probing keys and probing sites are both bounded. The embed's own budget:
    // one popular seller page is many visitors, not one visitor many times.
    const visitor = await clientKey(await headers());
    if (!(await rateLimitKey(visitor, "embed_fetch", RATE_LIMITS.embedFetch))) return PAGE_BUSY;

    const admin = createAdminClient();
    const { data: storefront, error } = await admin
      .from("storefronts")
      .select(STOREFRONT_PAGE_SELECT)
      .eq("embed_key", embedKey)
      .maybeSingle();
    if (error) {
      console.error("[embed frame] storefront read failed", error.message);
      return PAGE_BUSY;
    }
    if (!storefront) return null;

    const result = await buildStorefrontPage(storefront, {
      allow: (config) => isEmbedSiteAllowed(config.embed, site.hostname),
      // An absolute address on the app's own origin, opened in a tab of its
      // own. `via=embed` files the visit, and any sale it leads to, under the
      // embed rather than "direct".
      tileHref: (productId) => productPageUrl(storefront.id, productId, { via: "embed" }),
    });
    if (!result || result === PAGE_BUSY) return result;
    return { ...result, site };
  },
);
