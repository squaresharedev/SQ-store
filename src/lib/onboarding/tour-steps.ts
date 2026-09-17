import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { can, type TeamAction, type TeamRole } from "@/lib/team/permissions";

/**
 * THE GUIDED TOUR, as data: one stop per thing worth pointing at, in order.
 *
 * Each step names the page it lives on and the REAL control it spotlights, found
 * by a selector the page already renders (an href, an aria-label, an id). A few
 * of those controls live in files other people are actively changing, so the
 * tour reads what is there rather than adding hooks to them; the
 * tour-targets component test and the guided-tour e2e specs are what make a
 * renamed label fail loudly instead of quietly falling back.
 *
 * Candidates are tried in order and the first one actually on screen wins (see
 * tour-dom.ts), which is how one list serves both surfaces: the desktop sidebar
 * and the phone's menu button, the top bar's search and the header's.
 *
 * Copy is short on purpose (one idea per stop), and honest about what is not
 * built: checkout, Stripe payouts and the embed widget are all said to be
 * coming rather than implied to work.
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
  selector: string;
  /** Replaces the step's body when this candidate is the one on screen. */
  body?: string;
  extra?: TourExtra;
  /** Replaces the step's preferred card side when this candidate is on screen
   *  (a docked column and a toolbar button want the card in different places). */
  side?: TourStep["side"];
};

export type TourStep<Id extends string = TourStepId> = {
  id: Id;
  /** The page the step lives on: a canonical pathname, no query. */
  path: `/${string}`;
  /** For "Opening {page}…" while the tour navigates there. */
  pageLabel: string;
  title: string;
  /** Used when no candidate's own body applies. */
  body: string;
  targets: readonly TourTarget[];
  /** Shown, centred and with nothing spotlit, when no candidate is on screen. */
  fallbackBody?: string;
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

const PAGE_INTRO = "This tour stops at the main thing to do on each page.";
const EMBED_IN_DEVELOPMENT =
  "The widget is still in development and doesn't show on other sites yet.";

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "overview-nav",
    path: "/dashboard",
    pageLabel: "Overview",
    title: "Find your way around",
    body: `Everything in your store is one click away from the menu. ${PAGE_INTRO}`,
    targets: [
      {
        selector: 'nav[aria-label="Dashboard"]',
        body: `Everything in your store is one click away in this sidebar. ${PAGE_INTRO}`,
      },
      {
        selector: 'header button[aria-label="Open menu"]',
        body: `Everything in your store is behind this menu. ${PAGE_INTRO}`,
      },
    ],
    scroll: false,
    side: "right",
  },
  {
    id: "search",
    path: "/dashboard",
    pageLabel: "Overview",
    title: "Search for anything",
    body: "Search jumps straight to any page, product, order or setting.",
    targets: [
      {
        selector: '[data-testid="top-bar"] button[aria-keyshortcuts]',
        body: "Jump straight to any page, product, order or setting.",
        extra: "search-shortcut",
      },
      {
        // Scoped to the header: the open search panel is also labelled Search.
        selector: 'header button[aria-label="Search"]',
        body: "Tap here to jump straight to any page, product, order or setting.",
      },
    ],
    scroll: false,
  },
  {
    id: "products-add",
    path: "/products",
    pageLabel: "Products",
    title: "Add a product",
    body: "A title and a price are enough to start. It can stay a draft until you're ready.",
    // The first match is the toolbar's; an empty store renders a second one in
    // its empty state further down.
    targets: [{ selector: 'main a[href="/products/new"]' }],
    scroll: true,
    requires: "products.write",
  },
  {
    id: "products-import",
    path: "/products",
    pageLabel: "Products",
    title: "Or import your catalogue",
    body: "Already selling somewhere else? Import a CSV file. A Shopify export works as it is.",
    targets: [{ selector: 'main a[href="/products/import"]' }],
    scroll: true,
    requires: "products.write",
  },
  {
    id: "storefront-create",
    path: "/storefront",
    pageLabel: "Storefront",
    title: "Create a storefront",
    body: "A storefront is a grid you design. Each product you place on it gets a page you can share.",
    targets: [{ selector: '[data-tour="storefront-create"]' }],
    scroll: true,
    requires: "storefront.write",
  },
  {
    id: "storefront-sample",
    path: "/storefront",
    pageLabel: "Storefront",
    title: "See how it's done",
    body: "This sample shows a finished storefront. Open it to try the designer. Nothing you change there is saved.",
    // The sample's card sits after the seller's own cards in the list.
    targets: [{ selector: "main [data-storefront-sample]" }],
    // They hid it: nothing to point at, so say where it went.
    fallbackBody:
      "Open a storefront to design it. The sample storefront you hid can be brought back from the bottom of this page.",
    waitFor: '[data-tour="storefront-create"]',
    scroll: true,
    requires: "storefront.write",
  },
  {
    id: "storefront-embed",
    path: "/storefront",
    pageLabel: "Storefront",
    title: "Embed a storefront on your site",
    body: `Each storefront has an embed button that gives you a snippet like this one. ${EMBED_IN_DEVELOPMENT}`,
    targets: [
      {
        selector: 'main button[aria-label^="Embed "]',
        body: `This button gives you a snippet like the one below to paste into your site. ${EMBED_IN_DEVELOPMENT}`,
        extra: "embed-snippet",
      },
    ],
    // First match in DOM order: the seller's own card when they have one, the
    // sample's otherwise. No card at all only when both are missing.
    fallbackBody: `Once you have a storefront, the embed button on its card gives you a snippet like this one. ${EMBED_IN_DEVELOPMENT}`,
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
    pageLabel: "Orders",
    title: "Find an order",
    // Keep in step with OrdersEmptyState, which makes the same promise.
    body: "Search by the buyer's email. Orders land here once Square Share checkout opens.",
    targets: [{ selector: '[data-tour="orders-search"]' }, { selector: "#orders-search" }],
    scroll: true,
    reveal: "orders-toolbar",
  },
  {
    id: "orders-filters",
    path: "/orders",
    pageLabel: "Orders",
    title: "Filter and sort",
    body: "Narrow orders by channel, status or date, and choose how they're sorted.",
    targets: [{ selector: '[role="search"][aria-label="order filters"]' }],
    scroll: true,
    reveal: "orders-toolbar",
  },
  {
    id: "analytics",
    path: "/analytics",
    pageLabel: "Analytics",
    title: "See how it's going",
    body: "Sales and visits to your product pages, over the dates you choose.",
    targets: [
      {
        selector: '[role="group"][aria-label="Date range"]',
        body: "Sales and visits to your product pages, for the dates you pick here.",
      },
      {
        // A store with nothing to measure yet renders one empty state instead.
        selector: "[data-analytics-first-run] > div",
        body: "Sales and visits to your product pages show up here once one is live.",
      },
    ],
    waitFor: "[data-analytics-range-preset]",
    scroll: true,
  },
  {
    id: "payments",
    path: "/payments",
    pageLabel: "Payments",
    title: "Getting paid",
    body: STRIPE_CONNECT_AVAILABLE
      ? "Connect Stripe here so payouts go straight to your bank."
      : "Getting paid through Stripe is coming soon. Until then, buyers pay you through your product's buy link or by email.",
    targets: [{ selector: 'section[aria-label="Stripe connection"]' }],
    scroll: true,
  },
  {
    id: "finish",
    path: "/settings/account",
    pageLabel: "Settings",
    title: "Replay the tour any time",
    body: "That's the tour. You can start it again from here whenever you like.",
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
