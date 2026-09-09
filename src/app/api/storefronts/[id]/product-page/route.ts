import { revalidatePath } from "next/cache";
import { resolveCta, resolveInk } from "@/components/product-page/product-page-maps";
import {
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
  type ActionErrorCode,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { isDefaultProductPage, resolveProductPage } from "@/lib/storefront/product-page";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  parseStoredStorefrontConfig,
  productPageSchema,
  storefrontIdSchema,
} from "@/lib/validation/storefront";
import {
  PRODUCT_PAGE_CTA_BORDER_WIDTH_MAX,
  PRODUCT_PAGE_CTA_MAX,
  PRODUCT_PAGE_CTA_RADIUS_MAX,
  type ProductPageConfig,
  type StorefrontConfig,
} from "@/types/storefront";

/**
 * GET / PATCH /api/storefronts/[id]/product-page — the product page's options
 * (the buy button among them) as a plain, versionless JSON resource.
 *
 * WHY THIS EXISTS AT ALL, when the designer already edits every field here
 * through `saveStorefront`: a Server Action is addressed by a build-generated
 * id and is only invokable through Next's own client protocol, so anything
 * holding one breaks on the next deploy. docs/agent-surface.md states the
 * consequence plainly — Server Actions must never be the agent transport — and
 * the buy button is the first setting shipped with the route it needs.
 *
 * IT IS NOT THE AGENT SURFACE YET, and must not be mistaken for it. This
 * authenticates the SESSION COOKIE like every other route in the app, so it
 * serves the seller's own browser (and anything already holding their session)
 * and nobody else. What it does do is put the read and the write behind a
 * stable URL with a stable body, so the token layer described as B1/B2 in that
 * document is a change of *authentication* here rather than a new contract:
 *
 *   - swap `getActiveAccount()` (a cookie, B2) for a token naming the account;
 *   - keep the permission check, the rate limit and the payload exactly as they
 *     are, since `can(role, ...)` is already the map an agent token would carry.
 *
 * SHAPE OF THE READ. `productPage` is the STORED config resolved against the
 * defaults, and `buyButton` is what that config actually paints, resolved by
 * the same `resolveCta` the buyer's page calls — because four of the button's
 * five values are optional and "absent" means "follow the storefront", which
 * is a question a caller must never have to answer for itself. `limits` saves
 * a caller guessing what a write will accept.
 *
 * SHAPE OF THE WRITE. A partial config, merged over the current one. `null`
 * clears an optional field back to inheriting, which is the one thing a plain
 * merge cannot express. The merged whole is then validated by
 * `productPageSchema` — the same schema the designer's save uses, so a write
 * arriving here can never store something the editor could not have — and a
 * page left at the defaults is stored as no member at all, exactly as
 * `handleSave` does it, so an untouched storefront's jsonb stays byte-identical.
 */

const STATUS: Record<ActionErrorCode, number> = {
  session_expired: 401,
  permission_denied: 403,
  not_found: 404,
  invalid_input: 400,
  upload_failed: 400,
  rate_limited: 429,
  server_error: 500,
  // The caller is authenticated and permitted, but the ACCOUNT has not
  // disclosed the trader details a buyer is entitled to, so the request cannot
  // be fulfilled as it stands: 409, the same answer any other "your account is
  // not in a state where this is allowed" gets. Not 403, which would say the
  // token lacks the right — it does not.
  trader_identity_required: 409,
  unexpected: 500,
};

/** ActionError verbatim as the error envelope, per docs/agent-surface.md: a
 *  stable machine `code`, a human `message`, and a `fix` that is a next step
 *  rather than an apology. */
function fail(error: ActionError) {
  return Response.json({ error }, { status: STATUS[error.code] });
}

/** The one payload both verbs answer with, so a write's response is a read. */
function payload(storefrontId: string, config: StorefrontConfig) {
  const productPage = resolveProductPage(config);
  return {
    storefrontId,
    productPage,
    buyButton: resolveCta(productPage, config.theme),
    // The page's backdrop, resolved the same way. `color` is null while the
    // page follows the storefront, because "follow" can mean a gradient or an
    // image and no single hex would be the truth; `ink` is what the page draws
    // its words in either way, and is derived rather than stored.
    background: {
      color: productPage.backgroundColor ?? null,
      followsStorefront: productPage.backgroundColor === undefined,
      ink: resolveInk(config.theme, productPage),
    },
    limits: {
      ctaLabelMax: PRODUCT_PAGE_CTA_MAX,
      ctaRadiusMax: PRODUCT_PAGE_CTA_RADIUS_MAX,
      ctaBorderWidthMax: PRODUCT_PAGE_CTA_BORDER_WIDTH_MAX,
    },
  };
}

/**
 * The storefront's stored config, or an error to answer with.
 *
 * ACCOUNT SCOPING IS NOT OPTIONAL: RLS lets a team member read every store
 * they belong to, so the query pins the ACTIVE account explicitly. Without it
 * a member of two stores could read (and with the write below, edit) either
 * one through the other's URL.
 */
async function loadConfig(
  id: string,
  accountId: string,
): Promise<{ config: StorefrontConfig } | { error: ActionError }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("config")
    .eq("id", id)
    .eq("owner_id", accountId)
    .maybeSingle();
  if (error) {
    console.error("[product-page] read failed", error.message);
    return { error: serverError("load your product page settings") };
  }
  if (!data) return { error: notFound("storefront") };
  const config = parseStoredStorefrontConfig(data.config);
  if (!config) {
    console.warn("[product-page] stored config failed to parse", id);
    return { error: serverError("load your product page settings") };
  }
  return { config };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!storefrontIdSchema.safeParse(id).success) return fail(notFound("storefront"));

  const account = await getActiveAccount();
  if (!account) return fail(sessionExpired());
  if (!can(account.role, "store.read")) {
    return fail(permissionDenied(account.role, "view storefronts"));
  }
  if (!(await rateLimit("product_page_read", RATE_LIMITS.productPageRead))) {
    return fail(rateLimited("read product page settings"));
  }

  const loaded = await loadConfig(id, account.accountId);
  if ("error" in loaded) return fail(loaded.error);
  return Response.json(payload(id, loaded.config));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!storefrontIdSchema.safeParse(id).success) return fail(notFound("storefront"));

  const account = await getActiveAccount();
  if (!account) return fail(sessionExpired());
  if (!can(account.role, "storefront.write")) {
    return fail(permissionDenied(account.role, "edit storefronts"));
  }
  // The designer's own budget: this writes the same column by the same rules,
  // so it is the same cost and belongs in the same bucket.
  if (!(await rateLimit("storefront_write", RATE_LIMITS.storefrontWrite))) {
    return fail(rateLimited("save storefronts"));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(
      invalidInput("That request body is not JSON.", "Send a JSON object of the fields to change."),
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(
      invalidInput(
        "That request body is not an object.",
        'Send a JSON object, e.g. {"ctaColor": "#1d4ed8"}.',
      ),
    );
  }

  const loaded = await loadConfig(id, account.accountId);
  if ("error" in loaded) return fail(loaded.error);
  const current = resolveProductPage(loaded.config);

  // Merge, then let the schema judge the WHOLE thing. A `null` deletes rather
  // than sets: for an optional field that is the only way to say "go back to
  // following the storefront", and for a required one the schema will now
  // refuse it by name, which is a better answer than storing a null.
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }

  const parsed = productPageSchema.safeParse(merged);
  if (!parsed.success) {
    // The schema's own message names the field and the bound it broke, which
    // is exactly what a caller (or an agent) needs to correct the call. It
    // carries no stored data, so returning it leaks nothing.
    return fail(
      invalidInput(
        parsed.error.issues[0]?.message ?? "Those product page settings are invalid.",
        "Check the field named above against `limits` from a GET of this URL, then try again.",
      ),
    );
  }
  const productPage = parsed.data as ProductPageConfig;

  // A page left at the defaults is stored as NO member, the same rule
  // handleSave applies: an untouched storefront must not start carrying a
  // productPage key just because something read it back and wrote it out.
  const config: StorefrontConfig = { ...loaded.config };
  if (isDefaultProductPage(productPage)) delete config.productPage;
  else config.productPage = productPage;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("storefronts")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[product-page] save failed", error.message);
    return fail(serverError("save your product page settings"));
  }
  if (!row) return fail(notFound("storefront"));

  revalidatePath(`/storefront/${id}`);
  return Response.json(payload(id, config));
}
