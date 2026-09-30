import { resolveCta, resolveInk } from "@/components/product-page/product-page-maps";
import { pageConfigRoute } from "@/lib/storefront/page-config-route";
import { isDefaultProductPage, resolveProductPage } from "@/lib/storefront/product-page";
import { productPageSchema } from "@/lib/validation/storefront";
import {
  PRODUCT_PAGE_CTA_BORDER_WIDTH_MAX,
  PRODUCT_PAGE_CTA_MAX,
  PRODUCT_PAGE_CTA_RADIUS_MAX,
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

// The handlers are the shared page settings route (lib/storefront/
// page-config-route.ts); the checkout's route is the same one over its own
// member.
const route = pageConfigRoute({
  member: "productPage",
  schema: productPageSchema,
  resolve: resolveProductPage,
  isDefault: isDefaultProductPage,
  payload,
  log: "product-page",
  operations: {
    read: "readProductPageSettings",
    load: "loadProductPageSettings",
    save: "saveProductPageSettings",
  },
  messages: {
    notJson: "Errors.productPageApi.notJson.message",
    notJsonFix: "Errors.productPageApi.notJson.fix",
    notObject: "Errors.productPageApi.notObject.message",
    notObjectFix: "Errors.productPageApi.notObject.fix",
    invalid: "Errors.productPageApi.invalid",
    invalidFix: "Errors.productPageApi.invalidFix",
  },
});

export const GET = route.GET;
export const PATCH = route.PATCH;
