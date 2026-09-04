import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { recordSignal, visitorHash } from "@/lib/analytics/record";
import { decideEmbedAccess, embedSignalCorsHeaders } from "@/lib/storefront/embed";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { uuidField } from "@/lib/validation/inputs";
import type { SignalKind } from "@/lib/analytics/signals";

/**
 * POST /api/embed/[key]/signal, the embed widget reporting an interaction.
 *
 * The second unauthenticated write-adjacent surface in the app, and it exists
 * so that a new embeddable block does not have to invent its own reporting
 * path. Every gate the read route has, this has too, in the same order:
 * uuid shape check, per-client rate limit, embed enabled + origin allowlist.
 *
 * WHAT MAY BE REPORTED HERE IS AN ALLOWLIST, and a short one.
 *
 *   - `storefront_view` is NOT accepted. The server counts views itself when
 *     it serves the payload (see ../route.ts). Accepting a client-reported
 *     view would mean a seller's headline number is whatever a stranger with
 *     the public embed key decides to POST.
 *   - `email_signup` and `booking` are NOT accepted either, for a sharper
 *     version of the same reason: those are CONVERSIONS. When those blocks
 *     ship they will have a server-side handler that actually creates the
 *     signup or the booking, and that handler is what should call
 *     recordSignal, a count written next to the real row, not instead of it.
 *
 * What is left is `product_click`: an interaction only the widget can observe,
 * that creates nothing, and whose worst case if forged is an inflated click
 * count on the forger's own seller. Rate limited and origin-gated anyway.
 *
 * Returns 204 on success and on a duplicate alike. The widget has nothing to
 * do with the answer and a body would only invite it to retry.
 */

/** Kinds a PUBLIC caller may report. Deliberately narrow: see the note above.
 *  Growing this list is a security decision, not a feature decision. */
const PUBLIC_SIGNAL_KINDS = ["product_click"] as const satisfies readonly SignalKind[];

const bodySchema = z.strictObject({
  kind: z.enum(PUBLIC_SIGNAL_KINDS),
  /** The block that was interacted with. Bounded and opaque; never rendered. */
  blockId: z.string().trim().min(1).max(64).optional(),
  /** The product opened, when the widget knows it. Kept in metadata rather
   *  than a column: it is context for a click, not the subject of one. */
  productId: z.uuid().optional(),
});

/** A miss and a refusal look identical from outside where that matters. */
function notFound() {
  return Response.json({ error: "Not found." }, { status: 404 });
}

export async function POST(
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
  // probing origins is bounded too. Its own budget rather than embedFetch's:
  // one page view is one payload fetch but can legitimately be several clicks,
  // and a write budget should never be spendable by a read.
  const who = await clientKey(request.headers);
  if (!(await rateLimitKey(who, "embed_signal", RATE_LIMITS.embedSignal))) {
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // No field detail: the body came from a public caller and the widget is
    // the only legitimate one, so a validation transcript helps nobody here.
    return Response.json({ error: "Invalid signal." }, { status: 400 });
  }

  let row: { id: string; owner_id: string; config: unknown } | null = null;
  try {
    const admin = createAdminClient();
    const result = await admin
      .from("storefronts")
      .select("id, owner_id, config")
      .eq("embed_key", key)
      .maybeSingle();
    if (result.error) {
      console.error("[embed-signal] read failed", result.error.message);
      return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
    }
    row = result.data;
  } catch (err) {
    console.error(
      "[embed-signal] client unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
  }

  if (!row) return notFound();

  const config = parseStoredStorefrontConfig(row.config);
  if (!config) return notFound();

  const decision = decideEmbedAccess({ settings: config.embed, origin });
  if (!decision.allowed) {
    return decision.status === 404
      ? notFound()
      : Response.json(
          { error: "This storefront is not embeddable here." },
          { status: 403 },
        );
  }

  await recordSignal({
    accountId: row.owner_id,
    kind: parsed.data.kind,
    storefrontId: row.id,
    channel: "embed",
    blockId: parsed.data.blockId ?? null,
    visitorHash: await visitorHash(row.owner_id, [
      who,
      request.headers.get("user-agent"),
    ]),
    // Metadata is BUILT, never the parsed body spread in: the schema is strict
    // today, but a field added to it later must not silently start landing in
    // a jsonb column that is explicitly documented as carrying no personal
    // data. Same reason the embed payload is built field by field.
    metadata: parsed.data.productId ? { product_id: parsed.data.productId } : {},
  });

  return new Response(null, {
    status: 204,
    headers: embedSignalCorsHeaders(decision.origin),
  });
}

/**
 * Preflight. A cross-origin POST with a JSON body is never simple, so the
 * widget always sends one of these first. Same allowlist decision as the POST.
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
    return new Response(null, {
      status: 204,
      headers: embedSignalCorsHeaders(decision.origin),
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
