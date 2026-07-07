import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GDPR data export. Streams everything we hold for the SIGNED-IN user —
 * profile, products, storefront config — as a downloadable JSON file.
 *
 * OWNER-SCOPED ONLY: the user id comes exclusively from the validated session
 * (never from query/body), every query filters on it, and RLS enforces the
 * same boundary underneath. There is no way to export someone else's data.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const [profile, products, storefronts] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("products").select("*").eq("owner_id", user.id),
    // A user can own MANY storefronts — export all of them, not just one.
    supabase.from("storefronts").select("*").eq("owner_id", user.id),
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
