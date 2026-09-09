import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SELLER_IDENTITY_SELECT,
  buildSellerIdentity,
} from "@/lib/settings/seller-identity";
import { isTraderIdentityComplete } from "@/lib/settings/trader-identity";
import { presignGetUrl } from "@/lib/r2";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";

// SERVER ONLY. Like every public read in this codebase, this is a service-role
// read behind an application gate, never an anon RLS policy.

const idSchema = uuidField();

/**
 * /api/og/p/[productId] — stable og-image URL for product share cards.
 *
 * PROBLEM IT SOLVES. The product page's image[0].url is a presigned R2 URL
 * that expires in ~2 h. Putting it into og:image works at share time — the
 * card is scraped immediately — but when a social network re-scrapes the card
 * a day later the image is gone. This route is a STABLE URL that 302-redirects
 * to a freshly signed one on every request, so the scraper always gets a live
 * image regardless of when it asks.
 *
 * GATE ORDER (same fail-closed discipline as getPublicProductPage):
 *   1. productId must be a UUID
 *   2. client IP spends a rate-limit token from the ogImage budget
 *   3. product must exist, be `active`, and have an image_key
 *   4. the OWNER must have disclosed the trader details that let them sell
 *   5. image_key must presign successfully
 * Every failure is a plain 404 (no body), so nothing is enumerable.
 *
 * Step 4 is here for consistency with the page this card advertises: a share
 * card is only ever the face of a product page, and that page 404s for a
 * seller who has not identified themselves (lib/products/public.ts). Leaving
 * this open would keep one public artefact of a store that is not allowed to
 * sell — not an offer in itself, but not something to leave dangling either.
 *
 * The redirect carries Cache-Control: no-store because the destination URL is
 * short-lived; intermediaries must not cache the 302 itself or a crawler would
 * follow a stale signed URL on the next pass.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> },
): Promise<Response> {
  const { productId } = await params;
  if (!idSchema.safeParse(productId).success) return new Response(null, { status: 404 });

  // Rate-limit before any database work: a scan pays before it learns anything.
  const key = await clientKey(await headers());
  if (!(await rateLimitKey(key, "og_image", RATE_LIMITS.ogImage))) {
    return new Response(null, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("products")
    // owner_id is read only to check the publish gate below; it never leaves.
    .select("image_key, owner_id")
    .eq("id", productId)
    .eq("status", "active")
    .not("image_key", "is", null)
    .maybeSingle();
  if (!row?.image_key) return new Response(null, { status: 404 });

  const { data: sellerRow, error: sellerError } = await admin
    .from("profiles")
    .select(SELLER_IDENTITY_SELECT)
    .eq("id", row.owner_id)
    .maybeSingle();
  // Fail closed, like every other arm of this gate: an identity we could not
  // read is one we cannot publish behind.
  if (sellerError) {
    console.error("[og] seller identity read failed", sellerError.message);
    return new Response(null, { status: 404 });
  }
  if (!isTraderIdentityComplete(buildSellerIdentity(sellerRow))) {
    return new Response(null, { status: 404 });
  }

  const signedUrl = await presignGetUrl(row.image_key);
  if (!signedUrl) return new Response(null, { status: 404 });

  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: {
      // No caching: the destination is a short-lived signed URL, and every
      // scrape request should resolve a fresh one.
      "cache-control": "no-store",
    },
  });
}
