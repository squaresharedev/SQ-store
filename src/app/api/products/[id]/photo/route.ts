import { createClient } from "@/lib/supabase/server";
import { presignGetUrl } from "@/lib/r2";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { RASTER_IMAGE_TYPES } from "@/lib/uploads/sniff";
import { productIdSchema } from "@/lib/validation/product";

/**
 * GET /api/products/[id]/photo: a product's main photo, from our own origin.
 *
 * WHY IT EXISTS. Everywhere else the dashboard shows a photo through a
 * presigned R2 URL, which an <img> can display but a page cannot READ: the
 * pixels are on another origin. The share cards cut the product out of its
 * photo in the browser (lib/share-card/cutout), and that needs the pixels.
 * Same origin needs no CORS rule on the bucket, and no rule is one that
 * cannot be missing in some environment.
 *
 * THE CHECKS: a signed-in member of the ACTIVE store with `store.read`, and a
 * product of that store (the store id comes from the session, never the
 * request). Every refusal is a bare status, no body: nothing is enumerable.
 * Only raster types are passed on (RASTER_IMAGE_TYPES), so nothing served
 * from here can run as markup on our origin.
 *
 * force-dynamic: it reads cookies, so it is never cached or prerendered; the
 * response itself may sit in this browser's private cache for a few minutes.
 */
export const dynamic = "force-dynamic";

/** How long this browser may reuse a photo before asking again. */
const PHOTO_MAX_AGE_SECONDS = 300;

function refuse(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!productIdSchema.safeParse(id).success) return refuse(404);

  const account = await getActiveAccount();
  if (!account) return refuse(401);
  if (!can(account.role, "store.read")) return refuse(403);

  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("image_key")
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (!data?.image_key) return refuse(404);

  const url = await presignGetUrl(data.image_key);
  if (!url) return refuse(404);
  const upstream = await fetch(url);
  const type = upstream.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!upstream.ok || !upstream.body || !RASTER_IMAGE_TYPES.includes(type)) return refuse(502);

  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": `private, max-age=${PHOTO_MAX_AGE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
