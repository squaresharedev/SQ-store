/**
 * The guided tour's contract with the pages it points at.
 *
 * The tour finds its controls by selectors that do not depend on the reader's
 * language: a `data-tour` id on the control, or an href, an id or a data
 * attribute the page already renders. Never a label: labels are translated,
 * and a tour that looked for "Dashboard" found nothing in Czech. So the real
 * components are rendered here in English AND in Czech, and every stop of both
 * tours must find its control in each. Stops on pages too heavy to render are
 * checked against their source (and walked end to end in e2e/63-guided-tour
 * and e2e/65-sample-storefront).
 *
 * jsdom has no layout, so this checks that a selector MATCHES; whether the
 * match is on screen is the e2e specs' job.
 */

import type { ReactElement, ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "../setup/render";
import { english } from "../setup/translate";
import { loadMessages, type Messages } from "@/i18n/messages";
import { tourStep, TOUR_STEPS, type TourStepId } from "@/lib/onboarding/tour-steps";
import { EDITOR_TOUR_STEPS, type EditorTourStepId } from "@/lib/onboarding/editor-tour-steps";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { SearchMobileTrigger } from "@/components/search/SearchMobileTrigger";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import { OrdersToolbar } from "@/components/orders/OrdersToolbar";
import { RangeSelector } from "@/components/analytics/RangeSelector";
import { ConnectionStatusCard } from "@/components/payments/ConnectionStatusCard";
import { StorefrontsList } from "@/components/storefront/StorefrontsList";
import { EditorToolbar } from "@/components/storefront/EditorToolbar";
import { useCanvasViewport } from "@/components/storefront/useCanvasViewport";

beforeAll(() => {
  // The storefront cards' live previews measure their box.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/search/SearchProvider", () => ({
  useSearch: () => ({
    isOpen: false,
    open: () => {},
    close: () => {},
    registerAnchor: () => () => {},
  }),
}));

// The storefront list's server actions and its setup flow, which only need to
// exist here.
vi.mock("@/lib/storefront/actions", () => ({
  deleteStorefront: vi.fn(),
  fetchStorefrontsPage: vi.fn(),
  createStorefront: vi.fn(),
  rotateEmbedKey: vi.fn(),
  updateEmbedSettings: vi.fn(),
}));
vi.mock("@/components/storefront/CreateStorefrontWizard", () => ({
  CreateStorefrontWizard: () => null,
}));

afterEach(cleanup);

/** English, and Czech merged over it exactly as the app loads it. */
const CATALOGUES: Record<"en" | "cs", Messages> = {
  en: await loadMessages("en"),
  cs: await loadMessages("cs"),
};

/** `ui` with its copy in `locale`. Nested inside ../setup/render's providers,
 *  so everything else about the app's chrome stays as every spec has it. */
function inLocale(locale: "en" | "cs", ui: ReactElement) {
  return (
    <NextIntlClientProvider locale={locale} messages={CATALOGUES[locale]} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

function renderIn(locale: "en" | "cs", ui: ReactElement) {
  const view = render(inLocale(locale, ui));
  return { ...view, rerender: (next: ReactElement) => view.rerender(inLocale(locale, next)) };
}

const selector = (id: TourStepId, index = 0) => tourStep(id)!.targets[index].selector;
const editorSelector = (id: EditorTourStepId, index = 0) =>
  EDITOR_TOUR_STEPS.find((step) => step.id === id)!.targets[index].selector;
const source = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

const NOT_CONNECTED = {
  connected: false,
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  requirementsDue: [],
};

const OWN_STOREFRONT: StorefrontSummary = {
  id: "60000000-0000-4000-8000-000000000006",
  name: "Gilt & Grain",
  blockCount: 0,
  updatedAt: "2026-09-01T00:00:00.000Z",
  config: DEFAULT_STOREFRONT_CONFIG,
  embedKey: "70000000-0000-4000-8000-000000000007",
  brief: {},
};

function Toolbar({ pagesOpen = false }: { pagesOpen?: boolean }) {
  const viewport = useCanvasViewport({ zoom: 1, pan: { x: 0, y: 0 } });
  return (
    <EditorToolbar
      onAddProduct={vi.fn()}
      onAddText={vi.fn()}
      onAddShape={vi.fn()}
      onAddElement={vi.fn()}
      onOpenShapesPanel={vi.fn()}
      canAddBlocks
      canUndo={false}
      canRedo={false}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      viewport={viewport}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onZoomReset={vi.fn()}
      onTidy={vi.fn()}
      canTidy
      settingsOpen={false}
      onToggleSettings={vi.fn()}
      pagesOpen={pagesOpen}
      canOpenPage
      onTogglePages={vi.fn()}
    />
  );
}

/**
 * Every control either tour points at that renders without a whole page
 * around it, laid out the way the app nests them (the sidebar and top bar
 * outside `main`, the page's own controls inside).
 */
function TourSurfaces() {
  return (
    <>
      <Sidebar topBarSlot={<SearchMobileTrigger />} />
      <div data-testid="top-bar">
        <SearchTrigger />
      </div>
      <main>
        <StorefrontsList
          storefronts={[OWN_STOREFRONT]}
          total={1}
          products={[]}
          canWrite
          sample="shown"
        />
        <OrdersToolbar
          filters={{}}
          onChange={vi.fn()}
          sort={{ field: "createdAt", direction: "desc" }}
          onSortChange={vi.fn()}
        />
        <RangeSelector preset="30d" range={{ from: null, to: null }} />
        <ConnectionStatusCard account={NOT_CONNECTED} onConnect={vi.fn()} />
        <Toolbar />
      </main>
    </>
  );
}

/** Candidates whose control lives on a page too heavy to render here. Their
 *  anchors are language-independent too, and checked against source below. */
const FROM_SOURCE: ReadonlySet<string> = new Set([
  'main a[href="/products/new"]',
  'main a[href="/products/import"]',
  "[data-analytics-first-run] > div",
  "[data-analytics-range-preset]",
  "#tour",
  "[data-design-panel] [data-panel-menu]",
  "[data-sample-create]",
]);

/** Every selector either tour looks up: each candidate, and each `waitFor`. */
const LOOKUPS = [...TOUR_STEPS, ...EDITOR_TOUR_STEPS].flatMap((step) => [
  ...step.targets.map((target) => ({ step: step.id, selector: target.selector })),
  ...(step.waitFor ? [{ step: step.id, selector: step.waitFor }] : []),
]);

describe.each(["en", "cs"] as const)("tour targets, with the UI in %s", (locale) => {
  it("finds every stop's control, in both tours", () => {
    renderIn(locale, <TourSurfaces />);
    const rendered = LOOKUPS.filter(({ selector }) => !FROM_SOURCE.has(selector));
    // Every data-tour lookup is one of the rendered ones.
    expect(
      LOOKUPS.filter(({ selector }) => selector.includes("data-tour=") && FROM_SOURCE.has(selector)),
    ).toEqual([]);
    expect(rendered.length).toBeGreaterThan(10);
    for (const { step, selector: lookup } of rendered) {
      expect(document.querySelector(lookup), `${step}: ${lookup}`).not.toBeNull();
    }
  });

  it("puts the spotlight on the right element, not merely a match", () => {
    renderIn(locale, <TourSurfaces />);
    expect(document.querySelector(selector("overview-nav", 0))?.tagName).toBe("NAV");
    expect(document.querySelector(selector("overview-nav", 1))?.closest("header")).not.toBeNull();
    expect(document.querySelector(selector("search", 1))?.closest("header")).not.toBeNull();
    expect(document.querySelector(selector("orders-filters"))).toHaveAttribute("role", "search");
    // The orders search stop takes in the label with the field.
    const searchStop = document.querySelector(selector("orders-search"));
    expect(searchStop?.querySelector("#orders-search")).not.toBeNull();
    expect(searchStop?.querySelector('label[for="orders-search"]')).not.toBeNull();
    expect(document.querySelector(selector("analytics", 0))).toHaveAttribute("role", "group");
    expect(document.querySelector(selector("payments"))?.tagName).toBe("SECTION");
    expect(document.querySelector(editorSelector("editor-add"))).toHaveAttribute("role", "toolbar");
    // The embed stop has the seller's own card to itself: the sample is a
    // link at the foot of the list now, not a card with a button of its own.
    expect(document.querySelectorAll(selector("storefront-embed"))).toHaveLength(1);
    expect(
      document.querySelector(selector("storefront-sample"))?.querySelector('a[href="/storefront/sample"]'),
    ).not.toBeNull();
  });

  it("keeps the product page stop on the toolbar button whether the pages are open or not", () => {
    const { rerender } = renderIn(locale, <Toolbar />);
    expect(document.querySelector(editorSelector("editor-page"))).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(<Toolbar pagesOpen />);
    expect(document.querySelector(editorSelector("editor-page"))).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("finds the Stripe card whether or not Stripe is connected", () => {
    const { rerender } = renderIn(
      locale,
      <ConnectionStatusCard account={NOT_CONNECTED} onConnect={vi.fn()} />,
    );
    expect(document.querySelector(selector("payments"))).not.toBeNull();
    rerender(
      <ConnectionStatusCard
        account={{ ...NOT_CONNECTED, connected: true, accountId: "acct_1", chargesEnabled: true }}
        onConnect={vi.fn()}
      />,
    );
    expect(document.querySelector(selector("payments"))).not.toBeNull();
  });
});

describe("tour targets outside English", () => {
  it("renders a UI the old English label lookups could not find their way around", () => {
    renderIn("cs", <TourSurfaces />);
    // The lookups the tour used before it had data-tour ids. With the UI in
    // Czech each finds nothing, which is the bug the ids fix; if one of these
    // ever matches, this spec is no longer rendering a translated UI.
    for (const englishLookup of [
      `nav[aria-label="${english("Dashboard.sidebar.navLabel")}"]`,
      `header button[aria-label="${english("Dashboard.sidebar.openMenu")}"]`,
      `header button[aria-label="${english("Search.trigger.label")}"]`,
      `[role="search"][aria-label="${english("Orders.toolbar.region")}"]`,
      `[role="group"][aria-label="${english("Analytics.range.ariaLabel")}"]`,
      `section[aria-label="${english("Payments.connection.label")}"]`,
      `[role="toolbar"][aria-label="${english("Storefront.toolbar.ariaLabel")}"]`,
    ]) {
      expect(document.querySelector(englishLookup), englishLookup).toBeNull();
    }
  });
});

describe("tour targets on the heavier pages", () => {
  it("keeps the anchors those pages render", () => {
    // Products: the toolbar's two links (whole-page component, in flux).
    const products = source("components/products/ProductsBrowser.tsx");
    expect(products).toContain('href="/products/new"');
    expect(products).toContain('href="/products/import"');
    expect(selector("products-add")).toBe('main a[href="/products/new"]');
    expect(selector("products-import")).toBe('main a[href="/products/import"]');

    // Storefront: both create buttons, and the sample's link.
    const list = source("components/storefront/StorefrontsList.tsx");
    expect(list.match(/data-tour="storefront-create"/g)).toHaveLength(2);
    expect(list).toContain('data-storefront-sample=""');
    expect(selector("storefront-sample")).toBe("main [data-storefront-sample]");

    // Analytics: the first-run empty state, when there is nothing to measure,
    // and the page's own proof that it has rendered.
    const analytics = source("components/analytics/AnalyticsPage.tsx");
    expect(analytics).toContain("data-analytics-first-run");
    expect(analytics).toContain("data-analytics-range-preset");
    expect(selector("analytics", 1)).toBe("[data-analytics-first-run] > div");
    expect(tourStep("analytics")!.waitFor).toBe("[data-analytics-range-preset]");

    // Settings: the replay card's wrapper is the last stop.
    const account = source("components/settings/AccountSection.tsx");
    expect(account).toMatch(/<div id="tour">\s*<TourReplayCard \/>/);
    expect(selector("finish")).toBe("#tour");
  });

  it("keeps the anchors the designer renders around the toolbar", () => {
    // The docked settings column: the panel's own attribute around the menu.
    expect(source("components/storefront/DesignPanel.tsx")).toContain('data-design-panel=""');
    expect(source("components/ui/PanelMenu.tsx")).toContain('data-panel-menu=""');
    expect(editorSelector("editor-design", 0)).toBe("[data-design-panel] [data-panel-menu]");
    // The sample's way out, in place of Save.
    expect(source("components/storefront/StorefrontDesigner.tsx")).toContain('data-sample-create=""');
    expect(editorSelector("editor-finish")).toBe("[data-sample-create]");
  });
});
