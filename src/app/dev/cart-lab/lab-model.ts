// The cart lab's state: the cart's look (components/cart/cart-look.ts, the
// platform's choices), the seller's own cart options (CartPageConfig), and
// what to draw it over. Defaults come from the ONE look that ships
// (CART_LOOK), never a copy, so the lab tunes what ships.

import {
  CART_ADD_FEEDBACK,
  CART_COUNT_STYLES,
  CART_FREE_LINES,
  CART_ICONS,
  CART_LOOK,
  CART_ROW_STYLES,
  CART_STEPPERS,
  CART_SUGGESTION_STYLES,
  type CartLook,
} from "@/components/cart/cart-look";
import { CART_AFTER_ADD, CART_MAIN_BUTTONS, type CartAfterAdd, type CartMainButton } from "@/types/storefront";
import { changedProps, decodeLabHash, encodeLabHash, pick, toJsx } from "../lab-kit/state";
import { LAB_SCENARIOS, LAB_SHOPS, type LabScenarioId, type LabShopId } from "./fixtures";

/** Where the lab draws the cart. */
export const LAB_PLACEMENTS = [
  { id: "panel", label: "The cart panel" },
  { id: "buttons", label: "Product page buttons" },
  { id: "header", label: "Cart button in a header" },
  { id: "page", label: "The cart page" },
  { id: "cards", label: "Cards on a board" },
  { id: "reviews", label: "Reviews on an order" },
] as const;
export type LabPlacementId = (typeof LAB_PLACEMENTS)[number]["id"];

export type CartLabState = CartLook & {
  mainButton: CartMainButton;
  afterAdd: CartAfterAdd;
  deliveryBar: boolean;
  /** The seller's "Add from cards" (cartPage.quickAdd). */
  quickAdd: boolean;
  /** The seller's "Goes well with" (cartPage.suggestions). */
  suggest: boolean;
  shop: LabShopId;
  scenario: LabScenarioId;
  placement: LabPlacementId;
};

export const LAB_DEFAULTS: CartLabState = {
  ...CART_LOOK,
  mainButton: "buyNow",
  afterAdd: "openCart",
  deliveryBar: true,
  quickAdd: true,
  suggest: true,
  shop: "clay",
  scenario: "three",
  placement: "panel",
};

/** A preset's partial state over the defaults. */
export function withDefaults(partial: Partial<CartLabState>): CartLabState {
  return { ...LAB_DEFAULTS, ...partial };
}

/** The look part alone: what ships in cart-look.ts. */
export function lookOf(state: CartLabState): CartLook {
  return {
    icon: state.icon,
    count: state.count,
    rows: state.rows,
    stepper: state.stepper,
    freeLine: state.freeLine,
    feedback: state.feedback,
    bump: state.bump,
    suggestions: state.suggestions,
  };
}

/** What to paste back: the look as CART_LOOK's changes, and the seller's
 *  options as the stored cartPage would hold them. */
export function labJsx(state: CartLabState): string {
  const look = toJsx("CART_LOOK", changedProps(CART_LOOK, lookOf(state)));
  const seller = toJsx(
    "cartPage",
    changedProps(
      { mainButton: "buyNow", afterAdd: "openCart", deliveryBar: true, quickAdd: true, suggestions: true },
      {
        mainButton: state.mainButton,
        afterAdd: state.afterAdd,
        deliveryBar: state.deliveryBar,
        quickAdd: state.quickAdd,
        suggestions: state.suggest,
      },
    ),
  );
  return `${look}\n${seller}`;
}

export function encodeState(state: CartLabState): string {
  return encodeLabHash(changedProps(LAB_DEFAULTS, state));
}

/** Back from the address bar, keeping only values each option list knows. */
export function decodeState(hash: string): CartLabState {
  const raw = decodeLabHash(hash) ?? {};
  const one = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
    list.includes(value as T) ? (value as T) : fallback;
  return {
    icon: one(raw.icon, CART_ICONS, LAB_DEFAULTS.icon),
    count: one(raw.count, CART_COUNT_STYLES, LAB_DEFAULTS.count),
    rows: one(raw.rows, CART_ROW_STYLES, LAB_DEFAULTS.rows),
    stepper: one(raw.stepper, CART_STEPPERS, LAB_DEFAULTS.stepper),
    freeLine: one(raw.freeLine, CART_FREE_LINES, LAB_DEFAULTS.freeLine),
    feedback: one(raw.feedback, CART_ADD_FEEDBACK, LAB_DEFAULTS.feedback),
    bump: typeof raw.bump === "boolean" ? raw.bump : LAB_DEFAULTS.bump,
    suggestions: one(raw.suggestions, CART_SUGGESTION_STYLES, LAB_DEFAULTS.suggestions),
    mainButton: one(raw.mainButton, CART_MAIN_BUTTONS, LAB_DEFAULTS.mainButton),
    afterAdd: one(raw.afterAdd, CART_AFTER_ADD, LAB_DEFAULTS.afterAdd),
    deliveryBar: typeof raw.deliveryBar === "boolean" ? raw.deliveryBar : LAB_DEFAULTS.deliveryBar,
    quickAdd: typeof raw.quickAdd === "boolean" ? raw.quickAdd : LAB_DEFAULTS.quickAdd,
    suggest: typeof raw.suggest === "boolean" ? raw.suggest : LAB_DEFAULTS.suggest,
    shop: one(raw.shop, LAB_SHOPS.map((entry) => entry.id), LAB_DEFAULTS.shop),
    scenario: one(raw.scenario, Object.keys(LAB_SCENARIOS) as LabScenarioId[], LAB_DEFAULTS.scenario),
    placement: one(raw.placement, LAB_PLACEMENTS.map((entry) => entry.id), LAB_DEFAULTS.placement),
  };
}

/** A random but sane look, keeping where and what it is drawn over. */
export function shuffle(state: CartLabState, random: () => number = Math.random): CartLabState {
  return {
    ...state,
    icon: pick(CART_ICONS, random),
    count: pick(CART_COUNT_STYLES, random),
    rows: pick(CART_ROW_STYLES, random),
    stepper: pick(CART_STEPPERS, random),
    freeLine: pick(CART_FREE_LINES, random),
    feedback: pick(CART_ADD_FEEDBACK, random),
    bump: random() < 0.5,
    suggestions: pick(CART_SUGGESTION_STYLES, random),
    mainButton: pick(CART_MAIN_BUTTONS, random),
  };
}
