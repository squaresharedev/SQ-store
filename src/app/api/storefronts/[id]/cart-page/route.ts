import { cartLaunched } from "@/lib/cart/availability";
import { CART_SUGGESTIONS_MAX } from "@/lib/cart/limits";
import { pageConfigRoute } from "@/lib/storefront/page-config-route";
import { isDefaultCartPage, resolveCartPage } from "@/lib/storefront/cart-page";
import { cartPageSchema } from "@/lib/validation/storefront";
import {
  CART_ADD_LABEL_MAX,
  CART_AFTER_ADD,
  CART_MAIN_BUTTONS,
  CART_NOTE_MAX,
  CART_TITLE_MAX,
  type StorefrontConfig,
} from "@/types/storefront";

/**
 * GET / PATCH /api/storefronts/[id]/cart-page: the cart's options as a plain
 * JSON resource, the cart's twin of ../checkout-page (see there, and
 * lib/storefront/page-config-route.ts, for why this is a route at all).
 *
 * SHAPE OF THE READ. `cartPage` is the stored options resolved against the
 * defaults (every member optional: absent is the default, so an untouched
 * cart reads `{}`). `live` says whether buyers can have a cart at all yet
 * (lib/cart/availability.ts cartLaunched): options saved before then take
 * effect when it is. `limits` are the text caps and `options` the closed
 * lists, so a caller discovers the choices from the resource.
 */
function payload(storefrontId: string, config: StorefrontConfig) {
  return {
    storefrontId,
    cartPage: resolveCartPage(config),
    live: cartLaunched(),
    limits: {
      addLabelMax: CART_ADD_LABEL_MAX,
      titleMax: CART_TITLE_MAX,
      noteMax: CART_NOTE_MAX,
      suggestionsShown: CART_SUGGESTIONS_MAX,
    },
    options: {
      mainButtons: CART_MAIN_BUTTONS,
      afterAdd: CART_AFTER_ADD,
    },
  };
}

const route = pageConfigRoute({
  member: "cartPage",
  schema: cartPageSchema,
  resolve: resolveCartPage,
  isDefault: isDefaultCartPage,
  payload,
  log: "cart-page",
  operations: {
    read: "readCartSettings",
    load: "loadCartSettings",
    save: "saveCartSettings",
  },
  messages: {
    notJson: "Errors.productPageApi.notJson.message",
    notJsonFix: "Errors.productPageApi.notJson.fix",
    notObject: "Errors.productPageApi.notObject.message",
    notObjectFix: "Errors.cartPageApi.notObjectFix",
    invalid: "Errors.cartPageApi.invalid",
    invalidFix: "Errors.cartPageApi.invalidFix",
  },
});

export const GET = route.GET;
export const PATCH = route.PATCH;
