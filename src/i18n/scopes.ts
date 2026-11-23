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
 * Needed by every page: toasts, the error boundary, the common action labels.
 * The policy link labels ride along because the error pages' BrandFooter shares
 * the legal link list (lib/legal/links.ts) with the buyer's product footer.
 *
 * "Errors" and "Validation" were here until 2026-11-17 (~14 KB gz combined on
 * every buyer page and embed frame). They are now in the scopes that need them
 * (auth, app, designer). The public scope carries "Validation.generic" for
 * EditableText's one seller-prose guard rendered on the buyer order-status page.
 */
const SHELL = [
  "Common",
  "LocaleSwitcher",
  "ErrorPage",
  "ProductPage.footer.policies",
] as const;

const ALL_NAMESPACES = null;

/**
 * The dashboard chrome: Sidebar, TopBar, TourOverlay, search, notifications,
 * and the shell-level actions they trigger. Ships on every page inside the
 * (dashboard) route group via (dashboard)/layout.tsx.
 *
 * Keys in subtrees (Settings.team.roles rather than Settings) avoid loading the
 * whole Settings or Billing namespace into every page; each section layout then
 * adds only what its own pages need.
 */
const APP_CHROME = [
  // Sidebar navigation labels, ViewingBanner, ProfileMenu account switcher
  "Nav",
  // Sidebar section labels (Dashboard.sidebar.*)
  "Dashboard.sidebar",
  // OverviewAddButton renders in the shell's mobile header on every page
  "Dashboard.overview",
  // Global search (SearchProvider, SearchTrigger, SearchOverlay)
  "Search",
  // Notification bell, list, inline actions. Whole namespace: DB-keyed types.
  "Notifications",
  // lib/team/permissions.ts ROLE_LABELS, imported by ProfileMenu
  "Settings.team.roles",
  // NotificationInlineAction uses this directly
  "Settings.team.inviteRow",
  // lib/team/actions.ts + lib/notifications/actions.ts msg() returns
  "Settings.team.success",
  // lib/team/emails.ts is in the shell closure (team invite actions)
  "Settings.team.inviteEmail",
  // PlanChip in Sidebar uses Billing.chip, Billing.plans, Billing.card (narrowed)
  "Billing.chip",
  "Billing.plans",
  "Billing.card",
  // ActiveTour (dynamic import from TourOverlay, present on every shell page)
  "Onboarding.tourOverlay",
  // tour-steps.ts key literals accessed by ActiveTour via t(step.title/body)
  "Onboarding.guidedTour",
  // lib/onboarding/editor-tour-steps.ts pulled in by TourOverlay/ActiveTour
  "Onboarding.editorTour",
  // lib/search/registry.ts pulled in by SearchProvider (SearchOverlay)
  "Products.metadata",
  // lib/storefront/setting-ref.ts pulled in transitively via ActiveTour chain
  "Storefront.settings",
  // ...whose cart entries are named by the Cart panel's own labels
  "Storefront.cartPage",
  // ...and whose entries for the editor upgrade's controls are named by those
  // controls' own labels (one string each, not the catalogues they sit in)
  "EditorType.panel.palette.title",
  "EditorType.panel.pairings.title",
  "EditorType.panel.textStyles.title",
  "EditorType.panel.valign.label",
  "EditorCards.panel.cardColor",
  "EditorCards.panel.blend.label",
  "EditorCards.panel.nameStrip",
  "EditorCards.panel.photoShape.label",
  "EditorCards.panel.shadow.label",
  "EditorFinish.panel.motion.label",
  "EditorFinish.panel.texture.label",
  "EditorFinish.panel.marquee.inspectorTitle",
  "EditorLayout.panel.band.title",
  "EditorLayout.panel.button.title",
  "EditorLayout.panel.header.logoAndMenu",
  // lib/auth/actions.ts + lib/auth/signup.ts in shell closure
  "Auth.success",
  // lib/security/events.ts in shell closure
  "Settings.security.activity.events",
  // lib/settings/trader-identity.ts in shell closure
  "Settings.sellerDetails.fields",
  // lib/moderation/removal.ts + fix-fields.ts in shell closure
  "Products.removal",
  // Server actions throughout the app return Errors.* keys as MessageRefs
  "Errors",
  // isValidationKey (lib/validation/messages.ts) uses the literal "Validation"
  "Validation",
] as const;

/** What the dashboard and settings ship (scope `app`, kept for the designer
 *  and storefrontList which still spread over it). No new code should reference
 *  this directly; use APP_CHROME + a section scope instead. */
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
  // The product form's add to order preview is the buyer page's own section.
  "ProductPage.addOns",
  // The reviews page draws each review's stars and badges in the product
  // page's own words.
  "ProductPage.reviews",
  "ProductPage.sale",
  "ProductPage.shippingProse",
  "Storefront.colors.presets",
  // That same preview takes the page's font from the helper these names sit with.
  "Storefront.fonts",
  "Storefront.textVariants",
  "Storefront.settings",
  // Server actions throughout the app return Errors.* and Validation.* keys as
  // MessageRefs; client components resolve them via useTranslations().
  "Errors",
  "Validation",
] as const;

// --- Per-section scopes (each app/(dashboard)/<section>/layout.tsx) ----------
// These are layered on top of appChrome via nested ExtendMessages, so they only
// list entries the section uniquely needs beyond what the shell already ships.

/** /dashboard (the overview page): metrics, recent orders, attention rows,
 *  setup checklist, tour link, install offer. */
const DASHBOARD_SECTION = [
  // DashboardHome, MetricTile, MobileRevenueHero, NeedsAttention, AttentionRows
  "Dashboard",
  // SetupChecklist, TourLink
  "Onboarding.checklist",
  // InstallOffer
  "Onboarding.install",
  // lib/onboarding/steps.ts msg() HANDED_DOWN keys
  "Onboarding.steps",
  // RecentOrders, OrderDetailSheet, OrderDetail, OrderStatusBadge, FulfilmentBadge,
  // OrderActions, OrderRefund + lib/orders/emails.ts + lib/dashboard/attention.ts
  "Orders",
] as const;

/** /products and sub-routes: product form, list, reviews, import. */
const PRODUCTS_SECTION = [
  "Products",
  // Product form previews the buyer-facing product page content
  "ProductPage.addOns",
  "ProductPage.reviews",
  "ProductPage.sale",
  "ProductPage.shippingProse",
  // The form preview uses storefront tile fonts and colour names
  "Storefront.colors.presets",
  "Storefront.fonts",
  "Storefront.textVariants",
  "Storefront.settings",
  // ShippingSection uses useTranslations("Settings") -- requires whole namespace
  "Settings",
  // ProductCard uses Orders.toShipCount via root translator (useTranslations())
  "Orders.toShipCount",
] as const;

/** /orders and sub-routes: order list, detail, fulfilment. */
const ORDERS_SECTION = [
  "Orders",
  // OrdersExportButton uses Billing.plans to name the plan that unlocks export
  "Billing.plans",
] as const;

/** /discounts and sub-routes. DiscountExample shows "Was X, now Y" in buyer
 *  words, so it needs ProductPage.sale. The discounts page also shows metric
 *  tiles and chart cards, and may display a product preview with shipping info. */
const DISCOUNTS_SECTION = [
  "Discounts",
  "ProductPage.sale",
  // lib/shipping/policy-prose.ts in closure via product preview
  "ProductPage.shippingProse",
  // lib/products/price.ts validation messages
  "Products.form.errors.price",
  // MetricTile component used for discount performance metrics
  "Dashboard.metric",
  // ChartCard component used in discounts analytics
  "Analytics.chart",
  // ProductEmptyState shown when no products are attached to a discount
  "Products.emptyState",
] as const;

/** /analytics. StatusBreakdown uses Orders.status template literal; MetricTile
 *  uses Dashboard.metric keys for empty-state defaults. */
const ANALYTICS_SECTION = [
  "Analytics",
  // StatusBreakdown.tsx uses Orders.status.* template literal
  "Orders.status",
  // MetricTile.tsx pendingDefault / zeroDefault
  "Dashboard.metric",
  // AnalyticsExportButton uses Billing.plans to name the plan that unlocks export
  "Billing.plans",
] as const;

/** /payments: earnings, balance, payouts, Stripe connection. */
const PAYMENTS_SECTION = [
  "Payments",
] as const;

/** /plans: plan picker, portal button (which mounts a step-up form). */
const PLANS_SECTION = [
  "Billing",
  // PortalButton -> StepUpScope -> StepUp.tsx uses these
  "Auth.stepUp",
  "Auth.factorPicker",
  // lib/auth/mfa-actions.ts success messages returned via StepUp.tsx
  "Settings.security.success",
] as const;

/** /notifications: the full history page. Notifications whole is in appChrome,
 *  so nothing extra is needed here. The layout is still created so the wiring
 *  check passes and nesting is consistent across all sections. */
const NOTIFICATIONS_SECTION = [] as const;

/**
 * The welcome flow's copy, part of the overview's scope (see `dashboard`
 * below for why it cannot be shipped only while the welcome is pending).
 *
 * Keys from lib/settings/actions.ts that are NOT called by WelcomeFlow
 * (saveUsername, saveBio, etc.) are still included here because the test
 * checks all literals in an imported action file. The extra strings are small.
 */
const WELCOME = [
  "Onboarding.welcome",
  // WelcomeFlow form fields + TermsSummary
  "Settings.sellerDetails.fields",
  "Settings.legal",
  // lib/contact-verification/actions.ts + ContactVerification component
  "Settings.contactVerification",
  // saveTaxInfo success messages
  "Settings.tax.success",
  // Other functions in lib/settings/actions.ts (not called by WelcomeFlow, but
  // the whole file is in the bundle closure so the test requires coverage)
  "Settings.account.success",
  "Settings.danger.success",
  "Settings.notifications.success",
  // lib/auth/mfa-actions.ts (via StepUp.tsx -> passkeyStepUpOptions)
  "Settings.security.success",
  // lib/account-deletion/emails.ts pulled in via lib/settings/actions.ts
  "Settings.danger.email",
  // StepUpField -> StepUp.tsx -> FactorPicker
  "Auth.stepUp",
  "Auth.factorPicker",
] as const;

/** What the storefront editor ships (scope `designer`). */
const DESIGNER = [
  "Storefront",
  // The editor upgrade's four catalogues, one per workstream (cards, type,
  // layout, finish): the panels' own words and what a board can say.
  "EditorCards",
  "EditorType",
  "EditorLayout",
  "EditorFinish",
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
  // EmbedSettings, EditableText, and storefront actions return Errors.* and
  // Validation.* keys as MessageRefs; client components resolve them via
  // useTranslations().
  "Errors",
  "Validation",
] as const;

export const CLIENT_SCOPES = {
  /** The root layout alone: enough for anything outside a route group. */
  shell: [],
  /** Login, reset password, two-factor. */
  auth: [
    "Auth",
    "Notifications",
    // The two-factor and recovery flows share their results and activity log
    // with Settings > Security; the seller-details field names travel in the
    // publish-gate error that any signed-in surface can show.
    "Settings.security.activity.events",
    "Settings.security.success",
    "Settings.sellerDetails.fields",
    // Auth server actions return Errors.auth.* and Validation.password.* keys
    // as MessageRefs; the forms resolve them with useTranslations().
    "Errors",
    "Validation",
  ],
  /** The hosted pages a buyer opens. Deliberately the smallest: it is the coldest visit. */
  public: [
    "ProductPage",
    // Font and text-style names the page renderer shares with the designer.
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
    // What the editor upgrade's faces can say to a buyer (a carousel's arrows,
    // a header menu's cart): the `board` half of each catalogue, never the
    // panels' half.
    "EditorCards.board",
    "EditorType.board",
    "EditorLayout.board",
    "EditorFinish.board",
    // EditableText renders a seller-prose guard on the buyer order-status page.
    "Validation.generic",
  ],
  /**
   * The dashboard chrome (Sidebar, TopBar, TourOverlay, search, notifications).
   * Applied by (dashboard)/layout.tsx via ExtendMessages on top of the shell.
   * Each section below layers its own entries on top of this via a nested
   * ExtendMessages in the section's own layout.tsx.
   */
  appChrome: APP_CHROME,
  /**
   * Overview page (/dashboard), the welcome flow's copy included. The flow is
   * mounted (closed) on every overview render and resolves its text while
   * closed, so its messages must always be there: shipping them only while
   * the welcome was pending logged MISSING_MESSAGE on every later visit, and
   * toggling a provider around the panel remounted it as the welcome ended.
   */
  dashboard: [...DASHBOARD_SECTION, ...WELCOME],
  /** Product pages (/products, /products/[id]/edit, /products/new, etc.). */
  products: PRODUCTS_SECTION,
  /** Orders pages (/orders, /orders/[id]). */
  orders: ORDERS_SECTION,
  /** Discounts pages. */
  discounts: DISCOUNTS_SECTION,
  /** Analytics page. */
  analytics: ANALYTICS_SECTION,
  /** Payments page. */
  payments: PAYMENTS_SECTION,
  /** Plans page. */
  plans: PLANS_SECTION,
  /** Notifications history page. All keys are in appChrome; nothing extra. */
  notifications: NOTIFICATIONS_SECTION,
  /**
   * The dashboard and settings (legacy combined scope). Still needed by
   * settings/layout.tsx and storefront/(list)/layout.tsx which are NOT nested
   * inside (dashboard) and therefore do not inherit appChrome automatically.
   * Settings extends shell and must include appChrome entries explicitly.
   */
  app: APP,
  /**
   * Settings (/settings/**). Extends the shell (not appChrome, since
   * settings/layout.tsx is outside the (dashboard) route group). Includes all
   * of APP_CHROME plus Auth and the full Settings and Billing namespaces.
   */
  settings: [
    ...APP_CHROME,
    // All two-factor and account-security flows live in settings
    "Auth",
    // The whole Settings namespace: every section is accessible here
    "Settings",
    // The whole Billing namespace: plan picker, portal, invoices
    "Billing",
    // Product removal notice shown in seller details
    "Products.removal",
    // Policy text previewed exactly as buyers read it
    "ProductPage.addOns",
    "ProductPage.reviews",
    "ProductPage.sale",
    "ProductPage.shippingProse",
    // Storefront preview fonts and colours in settings
    "Storefront.colors.presets",
    "Storefront.fonts",
    "Storefront.textVariants",
    "Storefront.settings",
    "Storefront.masthead",
    // Tour replay card in Account settings
    "Onboarding.tourReplay",
    // Welcome scope keys for the welcome flow accessible from settings too
    "Onboarding.welcome",
    "Settings.sellerDetails.fields",
    "Settings.legal",
  ] as const,
  /**
   * The storefront editor (/storefront/[id]), full-screen with no dashboard
   * chrome: the designer's own copy and the product page it previews, and none
   * of the dashboard's.
   */
  designer: DESIGNER,
  /**
   * The storefront list (/storefront), which wears the dashboard shell and so
   * needs APP_CHROME entries, plus the whole Storefront namespace its previews
   * are drawn with (the designer's tile faces). The list pages also pull in
   * product-related components (ProductTileContent, ProductCard, FormSectionNav,
   * DecisionActions) and settings components (SellerDetailsNotice, ShippingPolicy).
   */
  storefrontList: [
    ...APP_CHROME,
    "Storefront",
    // The list's previews draw boards, so they can say what a board says.
    "EditorCards.board",
    "EditorType.board",
    "EditorLayout.board",
    "EditorFinish.board",
    // SellerDetailsNotice.tsx uses Settings.sellerDetails.* beyond just .fields
    "Settings.sellerDetails",
    // ProductTileContent.tsx uses ProductPage.sale and ProductPage.addOns,
    // and ProductPage.cart for a card that adds to the cart
    "ProductPage.sale",
    "ProductPage.addOns",
    "ProductPage.cart",
    // lib/shipping/policy-prose.ts in closure via product tile shipping info
    "ProductPage.shippingProse",
    // ProductCard, FormSectionNav, form-datapoints, price.ts, DecisionActions, etc.
    "Products",
  ],
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
