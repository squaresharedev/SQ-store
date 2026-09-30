import { resolveCta } from "@/components/product-page/product-page-maps";
import { resolveCheckoutTheme } from "@/components/checkout/checkout-theme";
import { pageConfigRoute } from "@/lib/storefront/page-config-route";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { isDefaultCheckoutPage, resolveCheckoutPage } from "@/lib/storefront/checkout-page";
import { checkoutPageSchema } from "@/lib/validation/storefront";
import {
  CHECKOUT_CELEBRATIONS,
  CHECKOUT_HEADLINE_MAX,
  CHECKOUT_LAYOUTS,
  CHECKOUT_NOTE_MAX,
  CHECKOUT_TEXTURES,
  CHECKOUT_THANKS_MESSAGE_MAX,
  type StorefrontConfig,
} from "@/types/storefront";

/**
 * GET / PATCH /api/storefronts/[id]/checkout-page: the checkout's design as a
 * plain JSON resource, the checkout's twin of ../product-page (see there, and
 * lib/storefront/page-config-route.ts, for why this is a route at all and what
 * it will and will not be).
 *
 * SHAPE OF THE READ. `checkoutPage` is the stored design resolved against the
 * defaults; `payButton` and `surface` are what it actually paints, resolved by
 * the same functions the buyer's checkout calls, because the pay button IS the
 * product page's buy button and the surface inherits through the product page
 * to the storefront, which is a question a caller must never answer itself.
 * `limits` are the text caps the schema holds the words to, and `options` the
 * closed lists the enum fields accept, so a caller discovers the presets
 * (the textures among them) from the resource rather than from a copy of them.
 * A texture is set by name and cleared with `null`, which leaves the page plain.
 */
function payload(storefrontId: string, config: StorefrontConfig) {
  const productPage = resolveProductPage(config);
  const checkoutPage = resolveCheckoutPage(config);
  const theme = resolveCheckoutTheme({
    id: storefrontId,
    name: "",
    theme: config.theme,
    productPage,
    checkoutPage,
    shippingPolicy: {},
    seller: {},
    backgroundImageUrl: null,
    customFontUrl: null,
  });
  return {
    storefrontId,
    checkoutPage,
    payButton: resolveCta(productPage, config.theme),
    surface: {
      color: theme.surface,
      ink: theme.ink,
      followsProductPage: checkoutPage.backgroundColor === undefined,
      // The pattern drawn over `color` in `ink`, or null for a plain page.
      texture: checkoutPage.texture ?? null,
    },
    limits: {
      headlineMax: CHECKOUT_HEADLINE_MAX,
      noteMax: CHECKOUT_NOTE_MAX,
      thanksMessageMax: CHECKOUT_THANKS_MESSAGE_MAX,
    },
    options: {
      layouts: CHECKOUT_LAYOUTS,
      textures: CHECKOUT_TEXTURES,
      celebrations: CHECKOUT_CELEBRATIONS,
    },
  };
}

const route = pageConfigRoute({
  member: "checkoutPage",
  schema: checkoutPageSchema,
  resolve: resolveCheckoutPage,
  isDefault: isDefaultCheckoutPage,
  payload,
  log: "checkout-page",
  operations: {
    read: "readCheckoutSettings",
    load: "loadCheckoutSettings",
    save: "saveCheckoutSettings",
  },
  messages: {
    notJson: "Errors.productPageApi.notJson.message",
    notJsonFix: "Errors.productPageApi.notJson.fix",
    notObject: "Errors.productPageApi.notObject.message",
    notObjectFix: "Errors.checkoutPageApi.notObjectFix",
    invalid: "Errors.checkoutPageApi.invalid",
    invalidFix: "Errors.checkoutPageApi.invalidFix",
  },
});

export const GET = route.GET;
export const PATCH = route.PATCH;
