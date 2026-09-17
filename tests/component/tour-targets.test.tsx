/**
 * The guided tour's contract with the pages it points at.
 *
 * The tour finds its controls by selectors those pages already render (an
 * href, an aria-label, an id), so a renamed label would quietly turn a stop
 * into its unspotlit fallback. These pin each selector against the markup: by
 * rendering the real component where that is cheap, and by reading the source
 * where the component needs a whole page around it (those stops are also walked
 * end to end in e2e/63-guided-tour).
 *
 * jsdom has no layout, so this checks that a selector MATCHES; whether the
 * match is on screen is the e2e specs' job.
 */

import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "../setup/render";
import { tourStep, type TourStepId } from "@/lib/onboarding/tour-steps";
import { EDITOR_TOUR_STEPS, type EditorTourStepId } from "@/lib/onboarding/editor-tour-steps";
import { EditorToolbar } from "@/components/storefront/EditorToolbar";
import { useCanvasViewport } from "@/components/storefront/useCanvasViewport";

beforeAll(() => {
  // The sample card's live preview measures its box.
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

afterEach(cleanup);

const selector = (id: TourStepId, index = 0) => tourStep(id)!.targets[index].selector;
const source = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

describe("tour targets", () => {
  it("finds the orders search and filters on the real toolbar", async () => {
    const { OrdersToolbar } = await import("@/components/orders/OrdersToolbar");
    const { container } = render(
      <main>
        <OrdersToolbar
          filters={{}}
          onChange={vi.fn()}
          sort={{ field: "createdAt", direction: "desc" }}
          onSortChange={vi.fn()}
        />
      </main>,
    );
    const searchStop = container.querySelector(selector("orders-search"));
    expect(searchStop).not.toBeNull();
    // The spotlight takes in the label with the field.
    expect(searchStop?.querySelector("#orders-search")).not.toBeNull();
    expect(searchStop?.querySelector('label[for="orders-search"]')).not.toBeNull();
    expect(container.querySelector(selector("orders-search", 1))).not.toBeNull();
    expect(container.querySelector(selector("orders-filters"))).not.toBeNull();
  });

  it("finds the Stripe card on Payments", async () => {
    const { ConnectionStatusCard } = await import("@/components/payments/ConnectionStatusCard");
    const { container } = render(
      <ConnectionStatusCard
        account={{
          connected: false,
          accountId: null,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          requirementsDue: [],
        }}
        onConnect={vi.fn()}
      />,
    );
    expect(container.querySelector(selector("payments"))).not.toBeNull();
  });

  it("finds the sidebar on desktop and the menu button and search on a phone", async () => {
    const { Sidebar } = await import("@/components/dashboard/Sidebar");
    const { SearchMobileTrigger } = await import("@/components/search/SearchMobileTrigger");
    render(<Sidebar topBarSlot={<SearchMobileTrigger />} />);
    expect(document.querySelector(selector("overview-nav", 0))).not.toBeNull();
    expect(document.querySelector(selector("overview-nav", 1))).not.toBeNull();
    expect(document.querySelector(selector("search", 1))).not.toBeNull();
  });

  it("finds the desktop search trigger inside the top bar", async () => {
    const { SearchTrigger } = await import("@/components/search/SearchTrigger");
    const { container } = render(
      <div data-testid="top-bar">
        <SearchTrigger />
      </div>,
    );
    expect(container.querySelector(selector("search", 0))).not.toBeNull();
    // And the real top bar is that wrapper around that trigger.
    const topBar = source("components/layout/TopBar.tsx");
    expect(topBar).toContain('data-testid="top-bar"');
    expect(topBar).toContain("<SearchTrigger");
  });

  it("keeps the anchors the heavier pages render", () => {
    // Products: the toolbar's two links (whole-page component, in flux).
    const products = source("components/products/ProductsBrowser.tsx");
    expect(products).toContain('href="/products/new"');
    expect(products).toContain('href="/products/import"');
    expect(selector("products-add")).toContain('a[href="/products/new"]');
    expect(selector("products-import")).toContain('a[href="/products/import"]');

    // Storefront: both create buttons, the sample's list item, and each card's
    // embed button (the sample card's included).
    const list = source("components/storefront/StorefrontsList.tsx");
    expect(list.match(/data-tour="storefront-create"/g)).toHaveLength(2);
    expect(list).toContain('<li data-storefront-sample="">');
    expect(selector("storefront-sample")).toBe("main [data-storefront-sample]");
    expect(source("components/storefront/StorefrontCard.tsx")).toContain(
      "aria-label={`Embed ${name}`}",
    );
    expect(source("components/storefront/SampleStorefrontCard.tsx")).toContain(
      "aria-label={`Embed ${SAMPLE_STOREFRONT_NAME}`}",
    );
    expect(selector("storefront-embed")).toContain('aria-label^="Embed "');

    // Analytics: the range selector, or the first-run empty state.
    expect(source("components/analytics/RangeSelector.tsx")).toContain('ariaLabel="Date range"');
    expect(source("components/analytics/AnalyticsPage.tsx")).toContain("data-analytics-first-run");

    // Settings: the replay card's wrapper is the last stop.
    const account = source("components/settings/AccountSection.tsx");
    expect(account).toMatch(/<div id="tour">\s*<TourReplayCard \/>/);
  });

  it("finds the sample storefront card and its embed button on the real card", async () => {
    const { SampleStorefrontCard } = await import("@/components/storefront/SampleStorefrontCard");
    const { container } = render(
      <main>
        <ul>
          <li data-storefront-sample="">
            <SampleStorefrontCard onEmbed={vi.fn()} onHide={vi.fn()} />
          </li>
        </ul>
      </main>,
    );
    expect(container.querySelector(selector("storefront-sample"))).not.toBeNull();
    expect(container.querySelector(selector("storefront-embed"))).not.toBeNull();
  });
});

describe("editor tour targets", () => {
  const editorSelector = (id: EditorTourStepId, index = 0) =>
    EDITOR_TOUR_STEPS.find((step) => step.id === id)!.targets[index].selector;

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

  it("finds the toolbar, its Design settings button and its product page button", () => {
    const { container, rerender } = render(<Toolbar />);
    expect(container.querySelector(editorSelector("editor-add"))).not.toBeNull();
    expect(container.querySelector(editorSelector("editor-design", 1))).not.toBeNull();
    expect(container.querySelector(editorSelector("editor-page", 0))).not.toBeNull();
    rerender(<Toolbar pagesOpen />);
    expect(container.querySelector(editorSelector("editor-page", 1))).not.toBeNull();
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
