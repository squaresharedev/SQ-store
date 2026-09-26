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
  /** The hosted product page. Deliberately the smallest: it is the coldest visit. */
  public: [
    "ProductPage",
    // A removed product's notice, and the font and text-style names the page
    // renderer shares with the designer.
    "Products.removal",
    "Storefront.fonts",
    "Storefront.textVariants",
  ],
  /**
   * The dashboard and settings. Not the designer's copy, apart from what the
   * global search lists (its settings and colour names) and the policy and
   * shipping wording that settings previews exactly as buyers read it.
   */
  app: [
    "Analytics",
    "Auth",
    "Dashboard",
    "Nav",
    "Notifications",
    "Onboarding",
    "Orders",
    "Payments",
    "Products",
    "Search",
    "Settings",
    "ProductPage.footer.policies",
    "ProductPage.shippingProse",
    "Storefront.colors.presets",
    "Storefront.settings",
  ],
  /** The storefront list and designer, and the /dev harness pages. */
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
  for (const entry of entries) {
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
