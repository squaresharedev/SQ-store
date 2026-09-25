import type { MessageKey } from "@/i18n/types";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { can, type TeamAction, type TeamRole } from "@/lib/team/permissions";

/**
 * THE GUIDED TOUR, as data: one stop per thing worth pointing at, in order.
 *
 * Each step names the page it lives on and the REAL control it spotlights, found
 * by a selector that never depends on the reader's language: a `data-tour` id
 * on the control, or an href, an id or a data attribute the page already
 * renders. NEVER an aria-label or visible text: those are translated, and a
 * lookup by English words finds nothing in Czech. The tour-targets component
 * test renders the targets in another language to keep it that way, and the
 * guided-tour e2e specs walk the stops end to end.
 *
 * Candidates are tried in order and the first one actually on screen wins (see
 * tour-dom.ts), which is how one list serves both surfaces: the desktop sidebar
 * and the phone's menu button, the top bar's search and the header's.
 *
 * Copy is short on purpose (one idea per stop), and honest about what is not
 * built: checkout, Stripe payouts and the embed widget are all said to be
 * coming rather than implied to work. It is message keys, resolved by the
 * overlay in the reader's language.
 *
 * Nothing here is stored: the tour's position is session state
 * (tour-store.ts), and this module stays pure so it can be tested in node.
 */

export const TOUR_STEP_IDS = [
  "overview-nav",
  "search",
  "products-add",
  "products-import",
  "storefront-create",
  "storefront-sample",
  "storefront-embed",
  "orders-search",
  "orders-filters",
  "analytics",
  "payments",
  "finish",
] as const;

export type TourStepId = (typeof TOUR_STEP_IDS)[number];

/** Something the card shows under its body for a particular target. */
export type TourExtra = "search-shortcut" | "embed-snippet";

/** A control a page shows only while the tour is pointing at it. */
export type TourReveal = "orders-toolbar";

export type TourTarget = {
  /** Language-independent: see the note at the top of this file. */
  selector: string;
  /** Replaces the step's body when this candidate is the one on screen. */
  body?: MessageKey;
  extra?: TourExtra;
  /** Replaces the step's preferred card side when this candidate is on screen
   *  (a docked column and a toolbar button want the card in different places). */
  side?: TourStep["side"];
};

/** Every page a tour can send the seller to: the sidebar's destinations, plus
 *  the sample storefront the editor tour runs on. */
export type TourPage =
  | "overview"
  | "products"
  | "storefront"
  | "orders"
  | "analytics"
  | "payments"
  | "settings"
  | "sampleStorefront";

export type TourStep<Id extends string = TourStepId> = {
  id: Id;
  /** The page the step lives on: a canonical pathname, no query. */
  path: `/${string}`;
  /** For "Opening Products…" while the tour navigates there. A stable id
   *  rather than the page's label, because the sentence is one whole message
   *  per page (Onboarding.tourOverlay.openingPage), never a label spliced into
   *  "Opening {page}…". */
  page: TourPage;
  title: MessageKey;
  /** Used when no candidate's own body applies. */
  body: MessageKey;
  targets: readonly TourTarget[];
  /** Shown, centred and with nothing spotlit, when no candidate is on screen. */
  fallbackBody?: MessageKey;
  fallbackExtra?: TourExtra;
  /** A selector that proves the page has rendered, before a missing target is
   *  believed to be missing rather than not painted yet. */
  waitFor?: string;
  /** Scroll the target into view. Off for fixed and sticky chrome. */
  scroll: boolean;
  /** Preferred side for the card on desktop. */
  side?: "bottom" | "top" | "right" | "left";
  /** Only shown to roles that can do the thing it points at. */
  requires?: TeamAction;
  reveal?: TourReveal;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "overview-nav",
    path: "/dashboard",
    page: "overview",
    title: "Onboarding.guidedTour.steps.overviewNav.title",
    body: "Onboarding.guidedTour.steps.overviewNav.body",
    targets: [
      {
        selector: '[data-tour="dashboard-nav"]',
        body: "Onboarding.guidedTour.steps.overviewNav.bodySidebar",
      },
      {
        selector: '[data-tour="menu-button"]',
        body: "Onboarding.guidedTour.steps.overviewNav.bodyMenu",
      },
    ],
    scroll: false,
    side: "right",
  },
  {
    id: "search",
    path: "/dashboard",
    page: "overview",
    title: "Onboarding.guidedTour.steps.search.title",
    body: "Onboarding.guidedTour.steps.search.body",
    targets: [
      {
        selector: '[data-testid="top-bar"] button[aria-keyshortcuts]',
        body: "Onboarding.guidedTour.steps.search.bodyTopBar",
        extra: "search-shortcut",
      },
      {
        selector: '[data-tour="search-phone"]',
        body: "Onboarding.guidedTour.steps.search.bodyPhone",
      },
    ],
    scroll: false,
  },
  {
    id: "products-add",
    path: "/products",
    page: "products",
    title: "Onboarding.guidedTour.steps.productsAdd.title",
    body: "Onboarding.guidedTour.steps.productsAdd.body",
    // The first match is the toolbar's; an empty store renders a second one in
    // its empty state further down.
    targets: [{ selector: 'main a[href="/products/new"]' }],
    scroll: true,
    requires: "products.write",
  },
  {
    id: "products-import",
    path: "/products",
    page: "products",
    title: "Onboarding.guidedTour.steps.productsImport.title",
    body: "Onboarding.guidedTour.steps.productsImport.body",
    targets: [{ selector: 'main a[href="/products/import"]' }],
    scroll: true,
    requires: "products.write",
  },
  {
    id: "storefront-create",
    path: "/storefront",
    page: "storefront",
    title: "Onboarding.guidedTour.steps.storefrontCreate.title",
    body: "Onboarding.guidedTour.steps.storefrontCreate.body",
    targets: [{ selector: '[data-tour="storefront-create"]' }],
    scroll: true,
    requires: "storefront.write",
  },
  {
    id: "storefront-sample",
    path: "/storefront",
    page: "storefront",
    title: "Onboarding.guidedTour.steps.storefrontSample.title",
    body: "Onboarding.guidedTour.steps.storefrontSample.body",
    // The quiet link to the sample at the foot of the list (StorefrontsList).
    targets: [{ selector: "main [data-storefront-sample]" }],
    // No link: this person hid the sample back when it was a card, or the flag
    // could not be read. Nothing to point at, so just say what the page is for.
    fallbackBody: "Onboarding.guidedTour.steps.storefrontSample.fallbackBody",
    waitFor: '[data-tour="storefront-create"]',
    scroll: true,
    requires: "storefront.write",
  },
  {
    id: "storefront-embed",
    path: "/storefront",
    page: "storefront",
    title: "Onboarding.guidedTour.steps.storefrontEmbed.title",
    body: "Onboarding.guidedTour.steps.storefrontEmbed.body",
    targets: [
      {
        selector: 'main [data-tour="storefront-embed"]',
        body: "Onboarding.guidedTour.steps.storefrontEmbed.bodyButton",
        extra: "embed-snippet",
      },
    ],
    // The first of the seller's own cards. A new seller has none (the sample is
    // a link, not a card), so they get the fallback, snippet and all.
    fallbackBody: "Onboarding.guidedTour.steps.storefrontEmbed.fallbackBody",
    fallbackExtra: "embed-snippet",
    // The create button renders with the list, so its presence means "no card"
    // really is no card rather than a list still on its way.
    waitFor: '[data-tour="storefront-create"]',
    scroll: true,
    requires: "storefront.write",
  },
  {
    id: "orders-search",
    path: "/orders",
    page: "orders",
    title: "Onboarding.guidedTour.steps.ordersSearch.title",
    // Keep in step with OrdersEmptyState, which makes the same promise.
    body: "Onboarding.guidedTour.steps.ordersSearch.body",
    targets: [{ selector: '[data-tour="orders-search"]' }, { selector: "#orders-search" }],
    scroll: true,
    reveal: "orders-toolbar",
  },
  {
    id: "orders-filters",
    path: "/orders",
    page: "orders",
    title: "Onboarding.guidedTour.steps.ordersFilters.title",
    body: "Onboarding.guidedTour.steps.ordersFilters.body",
    targets: [{ selector: '[data-tour="orders-filters"]' }],
    scroll: true,
    reveal: "orders-toolbar",
  },
  {
    id: "analytics",
    path: "/analytics",
    page: "analytics",
    title: "Onboarding.guidedTour.steps.analytics.title",
    body: "Onboarding.guidedTour.steps.analytics.body",
    targets: [
      {
        // The preset switch, not the row around it: the row also holds the
        // custom range's date field, and spans the page.
        selector: '[data-tour="analytics-range"] > [role="group"]',
        body: "Onboarding.guidedTour.steps.analytics.bodyRange",
      },
      {
        // A store with nothing to measure yet renders one empty state instead.
        selector: "[data-analytics-first-run] > div",
        body: "Onboarding.guidedTour.steps.analytics.bodyFirstRun",
      },
    ],
    waitFor: "[data-analytics-range-preset]",
    scroll: true,
  },
  {
    id: "payments",
    path: "/payments",
    page: "payments",
    title: "Onboarding.guidedTour.steps.payments.title",
    body: STRIPE_CONNECT_AVAILABLE
      ? "Onboarding.guidedTour.steps.payments.bodyConnect"
      : "Onboarding.guidedTour.steps.payments.bodyComingSoon",
    targets: [{ selector: '[data-tour="stripe-connection"]' }],
    scroll: true,
  },
  {
    id: "finish",
    path: "/settings/account",
    page: "settings",
    title: "Onboarding.guidedTour.steps.finish.title",
    body: "Onboarding.guidedTour.steps.finish.body",
    targets: [{ selector: "#tour" }],
    scroll: true,
  },
];

/** The steps this role gets: a stop pointing at something they cannot do is
 *  dropped rather than shown as a control they will never find. */
export function tourStepsFor(role: TeamRole | null | undefined): TourStep[] {
  return TOUR_STEPS.filter((step) => !step.requires || can(role, step.requires));
}

export function tourStep(id: string): TourStep | undefined {
  return TOUR_STEPS.find((step) => step.id === id);
}

export function isTourStepId(value: unknown): value is TourStepId {
  return typeof value === "string" && (TOUR_STEP_IDS as readonly string[]).includes(value);
}
