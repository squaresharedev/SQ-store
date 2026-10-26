import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import type { Product } from "@/types/product";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { StorefrontCard } from "@/components/storefront/StorefrontCard";

/**
 * A card whose storefront draws nothing has to SAY so.
 *
 * The preview is a faithful miniature, so an empty storefront renders as a
 * plain rectangle of the canvas colour: on the default white theme that is a
 * blank white box with nothing to explain it. These pin the hint that covers
 * that, and in particular pin it to what the preview will actually DRAW rather
 * than to the raw block count, which are not the same number.
 */

const PRODUCT_ID = "30000000-0000-4000-8000-000000000003";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

function product(): Product {
  return {
    id: PRODUCT_ID,
    title: "A print",
    description: "",
    priceCents: 1200,
    currency: "EUR",
    status: "active",
    imageKey: null,
    fileKey: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as unknown as Product;
}

function summary(config: StorefrontConfig): StorefrontSummary {
  return {
    id: "60000000-0000-4000-8000-000000000006",
    name: "Gilt & Grain",
    blockCount: config.blocks.length,
    updatedAt: "2026-08-09T00:00:00.000Z",
    config,
    embedKey: "70000000-0000-4000-8000-000000000007",
  };
}

function renderCard(config: StorefrontConfig, canWrite = true, sellerDetailsComplete = false) {
  return render(
    <StorefrontCard
      storefront={summary(config)}
      productsById={new Map([[PRODUCT_ID, product()]])}
      canWrite={canWrite}
      sellerDetailsComplete={sellerDetailsComplete}
      onEmbed={() => {}}
      onDelete={() => {}}
    />,
  );
}

const shape: StorefrontBlock = {
  type: "shape",
  id: "80000000-0000-4000-8000-000000000008",
  kind: "square",
  color: "#171717",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

const soldOutProduct: StorefrontBlock = {
  type: "product",
  productId: PRODUCT_ID,
  soldOut: true,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

// "This grid is empty" rather than "No products yet": the old copy read as
// "you have no products at all" to a seller who had four — the grid just
// had none on it.
const EMPTY_LABEL = "This grid is empty";

describe("StorefrontCard page link", () => {
  const VIEW = /as buyers see it/;

  it("opens the page buyers see, straight from the list, once it is live", () => {
    renderCard({ ...DEFAULT_STOREFRONT_CONFIG, blocks: [] }, true, true);
    const link = screen.getByRole("link", { name: VIEW });
    expect(link.getAttribute("href")).toMatch(/^\/s\//);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("is there for a read-only member too: looking is not editing", () => {
    renderCard({ ...DEFAULT_STOREFRONT_CONFIG, blocks: [] }, false, true);
    expect(screen.getByRole("link", { name: VIEW })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Share or embed/ })).toBeNull();
  });

  it("is not offered while the seller details are missing or product pages are off", () => {
    renderCard({ ...DEFAULT_STOREFRONT_CONFIG, blocks: [] }, true, false);
    expect(screen.queryByRole("link", { name: VIEW })).toBeNull();
    cleanup();
    renderCard(
      { ...DEFAULT_STOREFRONT_CONFIG, blocks: [], productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: false } },
      true,
      true,
    );
    expect(screen.queryByRole("link", { name: VIEW })).toBeNull();
  });
});

describe("StorefrontCard empty preview", () => {
  it("explains the blank box when the storefront has no blocks", () => {
    renderCard({ ...DEFAULT_STOREFRONT_CONFIG, blocks: [] });
    expect(screen.getByText(EMPTY_LABEL)).toBeInTheDocument();
  });

  it("stays out of the way once there is something to look at", () => {
    renderCard({ ...DEFAULT_STOREFRONT_CONFIG, blocks: [shape] });
    expect(screen.queryByText(EMPTY_LABEL)).not.toBeInTheDocument();
  });

  // The case a raw `blockCount === 0` check would miss: the storefront HAS a
  // block, and the preview still draws nothing.
  it("appears when every block is a hidden sold-out product", () => {
    renderCard({
      ...DEFAULT_STOREFRONT_CONFIG,
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, hideSoldOut: true },
      blocks: [soldOutProduct],
    });
    expect(screen.getByText(EMPTY_LABEL)).toBeInTheDocument();
  });

  it("does not appear when the same block is left visible", () => {
    renderCard({
      ...DEFAULT_STOREFRONT_CONFIG,
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, hideSoldOut: false },
      blocks: [soldOutProduct],
    });
    expect(screen.queryByText(EMPTY_LABEL)).not.toBeInTheDocument();
  });

  it("shows for a read-only role too: a blank box needs explaining either way", () => {
    renderCard({ ...DEFAULT_STOREFRONT_CONFIG, blocks: [] }, false);
    expect(screen.getByText(EMPTY_LABEL)).toBeInTheDocument();
  });
});

describe("StorefrontCard empty decoration", () => {
  /** The decorative layer, found the way the DOM identifies it. */
  function decoration(container: HTMLElement) {
    return container.querySelector("svg[viewBox='0 0 200 150']");
  }

  // One look for every empty card: the storefront's own accent and canvas are
  // deliberately ignored, so a dark or tinted empty storefront reads the same
  // as a white one.
  it("ignores the storefront's accent and canvas", () => {
    const { container } = renderCard({
      ...DEFAULT_STOREFRONT_CONFIG,
      theme: {
        ...DEFAULT_STOREFRONT_CONFIG.theme,
        accent: "#c9a227",
        background: { kind: "solid", color: "#171717" },
      },
      blocks: [],
    });
    const svg = decoration(container) as SVGElement | null;
    expect(svg).not.toBeNull();
    expect(svg!.style.color).toBe("");
    expect(svg!.style.opacity).not.toBe("");
    expect(svg).toHaveClass("text-foreground");
    expect(svg!.parentElement).toHaveClass("bg-background");
  });
});
