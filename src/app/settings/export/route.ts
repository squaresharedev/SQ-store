import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * GDPR data export. Streams everything we hold for the SIGNED-IN user,
 * profile, products, storefront config, as a downloadable JSON file.
 *
 * OWNER-SCOPED ONLY: the user id comes exclusively from the validated session
 * (never from query/body), every query filters on it, and RLS enforces the
 * same boundary underneath. There is no way to export someone else's data.
 *
 * RATE LIMITED: this is the single most expensive read in the app (three
 * parallel full-account queries), and it is a GET a script can loop. A person
 * exports their data a handful of times ever; the budget only bites automation.
 *
 * EXPLICIT COLUMNS, not select("*"): the export is the USER'S data, not the
 * system's bookkeeping about it. Internal columns stay out deliberately:
 *   - image_key / digital_file_key are R2 object paths (infrastructure
 *     addressing, and the file key is the thing the paywall protects);
 *   - embed_key is a live secret (the embed snippet credential) that does not
 *     belong in a JSON file sitting in a downloads folder;
 *   - is_seller / is_public and timestamps of internal flags are system state.
 * A new column is therefore NOT exported until someone decides it should be,
 * which is the right default for a file that leaves our custody.
 *
 * force-dynamic: not covered by settings/layout.tsx's auth gate (Route
 * Handlers sit outside the page/layout tree). See (dashboard)/layout.tsx for
 * why implicit cookies()-based dynamic detection isn't reliable here.
 */
export const dynamic = "force-dynamic";

const PROFILE_COLUMNS =
  "username, avatar_url, created_at, updated_at, " +
  "notify_sales, notify_product_updates, notify_marketing, " +
  "tax_business_name, tax_vat_id, tax_country, " +
  "seller_address, seller_email, seller_phone, " +
  "legal_accepted_at, legal_accepted_version, deletion_requested_at";

const PRODUCT_COLUMNS =
  "id, title, description, price_cents, currency, status, " +
  "track_stock, stock_quantity, low_stock_threshold, created_at, updated_at";

// `brief` is the seller's own answers from the creation flow, so it belongs in
// their export. `embed_key` still does not: see the note above.
const STOREFRONT_COLUMNS = "id, name, config, brief, created_at, updated_at";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await rateLimit("dataExport", RATE_LIMITS.dataExport))) {
    return NextResponse.json(
      { error: "You've exported your data several times recently. Try again in an hour." },
      { status: 429 },
    );
  }

  const [profile, products, storefronts] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("owner_id", user.id),
    // A user can own MANY storefronts; export all of them, not just one.
    supabase.from("storefronts").select(STOREFRONT_COLUMNS).eq("owner_id", user.id),
  ]);
  if (profile.error || products.error || storefronts.error) {
    return NextResponse.json(
      { error: "Export failed. Try again in a minute." },
      { status: 500 },
    );
  }

  const exportedAt = new Date();
  const payload = {
    exported_at: exportedAt.toISOString(),
    account: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    profile: profile.data,
    products: products.data,
    storefronts: storefronts.data,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="square-share-export-${exportedAt.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
