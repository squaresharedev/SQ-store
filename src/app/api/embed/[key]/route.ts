import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { decideEmbedAccess, embedCorsHeaders } from "@/lib/storefront/embed";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { uuidField } from "@/lib/validation/inputs";
import { readingOrder, type StorefrontBlock } from "@/types/storefront";
import { presignGetUrl } from "@/lib/r2";

/**
 * GET /api/embed/[key] — the PUBLIC storefront payload for the embed widget.
 *
 * The only unauthenticated read surface in the app, so every gate is here:
 *
 *   - `key` is the storefront's rotatable embed_key, never its row id, so a
 *     leaked snippet can be revoked without destroying the storefront.
 *   - Embedding must be enabled AND the request's Origin must be on the
 *     seller's allowlist (lib/storefront/embed.ts owns those rules).
 *   - Rate limited per client: with no session there is nobody to bill it to,
 *     so the limit is keyed on the requesting IP.
 *   - The response is BUILT, never passed through: only the fields a buyer-
 *     facing render needs are copied out, so a column added to the row later
 *     cannot leak by default.
 *
 * Read through the service-role client because there is deliberately no `anon`
 * RLS policy for embed_key — the key alone must not be sufficient to read the
 * row, or the allowlist and the rate limit would both be bypassable.
 */

/** A miss and a refusal look identical from outside where that matters. */
function notFound() {
  return Response.json({ error: "Not found." }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  // Shape-check before touching the database, so a garbage path segment costs
  // nothing and can never reach the query as a malformed uuid.
  if (!uuidField().safeParse(key).success) return notFound();

  const origin = request.headers.get("origin");

  // Keyed on the caller, since there is no session. Taken BEFORE the read so a
  // flood cannot drive database work, and before the allowlist check so that
  // probing origins is bounded too.
  const who = await clientKey(request.headers);
  if (!(await rateLimitKey(who, "embed_fetch", RATE_LIMITS.embedFetch))) {
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let row: { id: string; name: string; config: unknown } | null = null;
  try {
    const admin = createAdminClient();
    const result = await admin
      .from("storefronts")
      .select("id, name, config")
      .eq("embed_key", key)
      .maybeSingle();
    if (result.error) {
      console.error("[embed] read failed", result.error.message);
      return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
    }
    row = result.data;
  } catch (err) {
    console.error(
      "[embed] client unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
  }

  if (!row) return notFound();

  const config = parseStoredStorefrontConfig(row.config);
  if (!config) {
    console.warn("[embed] stored config failed to parse", row.id);
    return notFound();
  }

  const decision = decideEmbedAccess({ settings: config.embed, origin });
  if (!decision.allowed) {
    // 404 for "not embeddable" so a disabled storefront is indistinguishable
    // from a wrong key; 403 for "wrong origin", which the site owner needs to
    // be able to diagnose. The reason is logged, never returned.
    console.warn("[embed] denied", row.id, decision.reason);
    return decision.status === 404
      ? notFound()
      : Response.json({ error: "This storefront is not embeddable here." }, { status: 403 });
  }

  const headers = {
    ...embedCorsHeaders(decision.origin),
    // Public, identical for every allowed viewer, and cheap to regenerate.
    "Cache-Control": "public, max-age=60, s-maxage=300",
  };

  return Response.json(
    {
      id: row.id,
      name: row.name,
      // Theme and header travel whole: both are pure presentation, every member
      // is schema-validated, and the widget needs all of it to render what the
      // seller designed. (An uploaded font's object KEY rides along inside the
      // theme, like the background image's already does; neither is a URL, and
      // the widget cannot fetch either without a signature we do not hand out.
      // Image BLOCKS are the deliberate exception — see publicBlocks: their
      // artwork is the block, so it ships as a signed, expiring URL.)
      theme: config.theme,
      header: config.header ?? null,
      blocks: await publicBlocks(config.blocks),
    },
    { headers },
  );
}

/**
 * Preflight. Answers with the same allowlist decision as the GET, so a
 * disallowed origin is refused before it ever sends the real request.
 */
export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!uuidField().safeParse(key).success) return new Response(null, { status: 404 });

  const origin = request.headers.get("origin");
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("storefronts")
      .select("config")
      .eq("embed_key", key)
      .maybeSingle();
    const config = data ? parseStoredStorefrontConfig(data.config) : null;
    const decision = decideEmbedAccess({ settings: config?.embed, origin });
    if (!decision.allowed) return new Response(null, { status: decision.status });
    return new Response(null, { status: 204, headers: embedCorsHeaders(decision.origin) });
  } catch {
    return new Response(null, { status: 503 });
  }
}

/**
 * The buyer-facing view of the blocks.
 *
 * Built field by field rather than spread, so nothing seller-private can ride
 * along: stock counts and thresholds are the live example (a competitor should
 * not learn inventory from a public embed), and a field added to the block
 * types later stays out until someone adds it here on purpose.
 */
async function publicBlocks(blocks: StorefrontBlock[]) {
  return Promise.all(
    readingOrder(blocks).map(async (block) => {
      const placement = { x: block.x, y: block.y, w: block.w, h: block.h };
      if (block.type === "product") {
        return {
          ...placement,
          type: "product" as const,
          productId: block.productId,
          soldOut: block.soldOut ?? false,
          // Framing IS the buyer-facing part of this block: the seller chose
          // which part of the photo the tile shows, and an embed that dropped
          // it would quietly re-centre every image they framed. Purely visual
          // and derived from a picture the embed already serves, so none of
          // the reasons this list is an allowlist apply.
          imagePlacement: block.imagePlacement,
        };
      }
      if (block.type === "shape") {
        return {
          ...placement,
          type: "shape" as const,
          kind: block.kind,
          color: block.color,
          borderWidth: block.borderWidth,
          opacity: block.opacity,
        };
      }
      if (block.type === "image") {
        // The ONE block whose payload carries a URL rather than a key, and
        // deliberately so: a widget cannot render `elements/{uuid}/...`, and
        // the bucket is private. The stored config still holds only the key —
        // this signature is minted per response and expires.
        //
        // (The theme's font and background keys stay unsigned: those are
        // consumed by the widget's own CSS, which is not built here.)
        const src = await presignGetUrl(block.key);
        return {
          ...placement,
          type: "image" as const,
          alt: block.alt,
          fit: block.fit,
          imagePlacement: block.imagePlacement,
          opacity: block.opacity,
          // Omitted rather than null when R2 is unconfigured, so the widget
          // sees a block with no source instead of a broken one.
          ...(src ? { src } : {}),
        };
      }
      return {
        ...placement,
        type: "text" as const,
        text: block.text,
        variant: block.variant,
        align: block.align,
        bold: block.bold,
        italic: block.italic,
        underline: block.underline,
        color: block.color,
        // The ranges that override the four fields above. Plain numbers and
        // hex, exactly as stored — the widget renders each run as its own
        // text node, so this stays as far from markup as the text itself.
        spans: block.spans,
        fontSize: block.fontSize,
        font: block.font,
      };
    }),
  );
}
