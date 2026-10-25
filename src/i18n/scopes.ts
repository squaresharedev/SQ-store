import type { Messages } from "./messages";

/**
 * Which parts of the catalogue each part of the app ships to the BROWSER:
 * whole namespaces, or one subtree of a namespace when a page needs only that.
 *
 * Server components read the full catalogue and send none of it. Client
 * components need their copy in the page, and shipping the whole catalogue
 * (about 50 KB gzipped, more in languages with longer words) with every
 * document would tax the pages that matter most: the buyer-facing product page
 * and the login page, where a visitor arrives cold. Each route group therefore
 * lists what its client components can ask for.
 *
 * tests/unit/i18n-client-scopes.test.ts fails when anything that reaches the
 * browser asks for a key its route group does not ship (including keys in
 * plain modules a client component imports), so adding the entry here is the
 * fix and forgetting to is caught before release.
 */

/**
 * Needed by every page: toasts, action errors, form validation, the error pages.
 * The policy link labels ride along because the error pages' BrandFooter shares
 * the legal link list (lib/legal/links.ts) with the buyer's product footer.
 */
const SHELL = [
  "Common",
  "LocaleSwitcher",
  "ErrorPage",
  "Errors",
  "Validation",
  "ProductPage.footer.policies",
] as const;

const ALL_NAMESPACES = null;

/** What the dashboard and settings ship (scope `app`, and inside `storefrontList`). */
const APP = [
  "Analytics",
  "Auth",
  "Billing",
  "Dashboard",
  "Discounts",
  "Nav",
  "Notifications",
  "Onboarding",
  "Orders",
  "Payments",
  "Products",
  "Search",
  "Settings",
  "ProductPage.footer.policies",
  "ProductPage.sale",
  "ProductPage.shippingProse",
  "Storefront.colors.presets",
  "Storefront.settings",
] as const;

/** What the storefront editor ships (scope `designer`). */
const DESIGNER = [
  "Storefront",
  "ProductPage",
  // The editor carries the dashboard's search, bell, tour and product form, but
  // not the pages those link to: the rest of Settings, Orders, Billing, and so on.
  "Search",
  "Nav",
  "Notifications",
  "Onboarding",
  "Products",
  // Team roles and invite wording, the seller-details notice a publish can raise,
  // and the security events the activity wording names.
  "Settings.team",
  "Settings.sellerDetails",
  "Settings.security.activity",
] as const;

export const CLIENT_SCOPES = {
  /** The root layout alone: enough for anything outside a route group. */
  shell: [],
  /** Login, reset password, two-factor. */
  auth: [
    "Auth",
    "Notifications",
    // The two-factor and recovery flows share their results and activity log
    // with Settings › Security; the seller-details field names travel in the
    // publish-gate error that any signed-in surface can show.
    "Settings.security.activity.events",
    "Settings.security.success",
    "Settings.sellerDetails.fields",
  ],
  /** The hosted pages a buyer opens. Deliberately the smallest: it is the coldest visit. */
  public: [
    "ProductPage",
    // A removed product's notice, and the font and text-style names the page
    // renderer shares with the designer.
    "Products.removal",
    "Storefront.fonts",
    "Storefront.textVariants",
    // The hosted storefront (/s/[storefrontId]) draws the board with the
    // designer's own tile faces and masthead, so it carries the few words
    // those can say: about a kilobyte, against the 44 the designer has.
    "Storefront.masthead",
    "Storefront.blockFace",
    "Storefront.tiles",
    "Storefront.inlineText",
    "Storefront.spotDrag",
    "Storefront.colors.fields",
    "Storefront.colors.inherit",
  ],
  /**
   * The dashboard and settings. Not the designer's copy, apart from what the
   * global search lists (its settings and colour names), the policy and
   * shipping wording that settings previews exactly as buyers read it, and how
   * a sale's price is said ("Was X, now Y"), which a discount's product list
   * says the same way.
   */
  app: APP,
  /**
   * The storefront editor (/storefront/[id]), full-screen with no dashboard
   * chrome: the designer's own copy and the product page it previews, and none
   * of the dashboard's.
   */
  designer: DESIGNER,
  /**
   * The storefront list (/storefront), which wears the dashboard shell and so
   * needs the app's copy, plus the whole Storefront namespace its previews are
   * drawn with (the designer's tile faces). One scope, not `app` nested over
   * `designer`: a nested scope replaces a namespace it shares (ExtendMessages),
   * and `app` carries only part of "Storefront".
   */
  storefrontList: [...APP, "Storefront"],
  /** The /dev harness pages, which show everything. */
  full: ALL_NAMESPACES,
} as const satisfies Record<string, readonly string[] | null>;

export type ClientScope = keyof typeof CLIENT_SCOPES;

/**
 * Every entry a scope ships, shell included: whole namespaces ("Settings") or
 * subtrees of one ("Storefront.settings"). Null means everything. For the test.
 */
export function scopeEntries(scope: ClientScope): readonly string[] | null {
  const own = CLIENT_SCOPES[scope];
  return own === null ? null : [...SHELL, ...own];
}

/**
 * What a scope adds on top of the shell the root layout ships: its own
 * entries, or (for null) everything the shell does not already carry.
 */
export function pickScope(messages: Messages, scope: ClientScope): Partial<Messages> {
  const own = CLIENT_SCOPES[scope];
  const entries = own === null ? Object.keys(messages).filter((n) => !SHELL.includes(n as never)) : own;
  return pick(messages, entries);
}

/** The root layout's own share: the shell alone. */
export function pickShell(messages: Messages): Partial<Messages> {
  return pick(messages, SHELL);
}

/** Copy just the named branches (dotted paths) out of the catalogue. */
function pick(messages: Messages, entries: readonly string[]): Partial<Messages> {
  const out: Record<string, unknown> = {};
  // "Storefront.settings" beside "Storefront" (a scope built from two lists)
  // adds nothing, and copying it into the whole namespace's own object would
  // write into the catalogue itself.
  const distinct = entries.filter((entry) => !entries.some((other) => entry.startsWith(`${other}.`)));
  for (const entry of distinct) {
    const parts = entry.split(".");
    let from: unknown = messages;
    let to = out;
    parts.forEach((part, i) => {
      from = (from as Record<string, unknown> | undefined)?.[part];
      if (from === undefined) return;
      if (i === parts.length - 1) to[part] = from;
      else to = (to[part] ??= {}) as Record<string, unknown>;
    });
  }
  return out as Partial<Messages>;
}
