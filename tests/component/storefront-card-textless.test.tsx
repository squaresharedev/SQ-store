import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { StorefrontCard } from "@/components/storefront/StorefrontCard";

/**
 * When the list card shows the storefront's words, and when it does not.
 *
 * A storefront with products is previewed as designed: the masthead, the text
 * blocks and the tile titles are part of how that shop looks, and there are
 * pictures around them to carry the card.
 *
 * A storefront with NO product tiles has nothing else in the box, so its type
 * becomes the entire picture — a smudge of unreadable words sitting directly
 * above the card's own readable heading. That case drops the words and shows
 * what is left: the shapes, or the empty-state hint.
 *
 * These pin both halves, plus every route a word could take back onto a
 * wordless card: per-tile overrides that answer to the block rather than the
 * theme, and the placeholder notices that exist only for the DESIGNER to read.
 */

const PRODUCT_ID = "30000000-0000-4000-8000-000000000003";
const MISSING_PRODUCT_ID = "30000000-0000-4000-8000-000000000004";
const STORE_NAME = "Gilt & Grain";
const MASTHEAD_NAME = "Gilt and Grain Atelier";
const BIO = "Small-batch letterpress, printed in Lisbon";
const PRODUCT_TITLE = "Marigold Press No. 4";

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
    title: PRODUCT_TITLE,
    description: "",
    price: 42,
    currency: "EUR",
    status: "active",
    imageUrl: "https://example.test/print.jpg",
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 0,
    maxPerOrder: 10,
  };
}

function summary(config: StorefrontConfig): StorefrontSummary {
  return {
    id: "60000000-0000-4000-8000-000000000006",
    name: STORE_NAME,
    blockCount: config.blocks.length,
    updatedAt: "2026-08-09T00:00:00.000Z",
    config,
    embedKey: "70000000-0000-4000-8000-000000000007",
    brief: {},
  };
}

function renderCard(config: StorefrontConfig) {
  return render(
    <StorefrontCard
      storefront={summary(config)}
      productsById={new Map([[PRODUCT_ID, product()]])}
      canWrite
      onEmbed={() => {}}
      onDelete={() => {}}
    />,
  );
}

const productBlock: StorefrontBlock = {
  type: "product",
  productId: PRODUCT_ID,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

const textBlock: StorefrontBlock = {
  type: "text",
  id: "80000000-0000-4000-8000-000000000008",
  text: "Everything ships within two days",
  variant: "heading",
  align: "left",
  x: 1,
  y: 0,
  w: 2,
  h: 1,
};

const shapeBlock: StorefrontBlock = {
  type: "shape",
  id: "80000000-0000-4000-8000-000000000009",
  kind: "square",
  color: "#171717",
  x: 3,
  y: 0,
  w: 1,
  h: 1,
};

/** A config with the masthead switched on, so its presence or absence is a
 *  decision here rather than the default of one that never had a masthead. */
function withMasthead(blocks: StorefrontBlock[]): StorefrontConfig {
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    header: { show: true, name: MASTHEAD_NAME, bio: BIO },
    blocks,
  };
}

describe("StorefrontCard preview - a storefront with products", () => {
  it("shows the masthead name and bio", () => {
    renderCard(withMasthead([productBlock, textBlock]));
    expect(screen.getByText(MASTHEAD_NAME)).toBeInTheDocument();
    expect(screen.getByText(BIO)).toBeInTheDocument();
  });

  it("shows a text block's words", () => {
    renderCard(withMasthead([productBlock, textBlock]));
    expect(screen.getByText(textBlock.text)).toBeInTheDocument();
  });

  it("shows the product tile's own title and price", () => {
    renderCard(withMasthead([productBlock, textBlock]));
    expect(screen.getByText(PRODUCT_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });
});

describe("StorefrontCard preview - a storefront with no products", () => {
  it("leaves the masthead name and bio off the card", () => {
    renderCard(withMasthead([textBlock, shapeBlock]));
    expect(screen.queryByText(MASTHEAD_NAME)).not.toBeInTheDocument();
    expect(screen.queryByText(BIO)).not.toBeInTheDocument();
  });

  it("leaves a text block's words off the card", () => {
    renderCard(withMasthead([textBlock, shapeBlock]));
    expect(screen.queryByText(textBlock.text)).not.toBeInTheDocument();
  });

  it("still shows the card's OWN heading: the storefront has to be named", () => {
    renderCard(withMasthead([textBlock, shapeBlock]));
    expect(screen.getByRole("heading", { name: STORE_NAME })).toBeInTheDocument();
  });

  it("does not swap a dropped text block for the designer's empty-block notice", () => {
    renderCard(withMasthead([{ ...textBlock, text: "" }, shapeBlock]));
    expect(screen.queryByText("Empty text block")).not.toBeInTheDocument();
  });

  it("keeps the shapes: only the words go", () => {
    const { container } = renderCard(withMasthead([textBlock, shapeBlock]));
    expect(container.querySelectorAll("li").length).toBe(1);
  });

  it("calls a board of nothing but words empty, since it draws nothing", () => {
    renderCard(withMasthead([textBlock]));
    expect(screen.getByText("This grid is empty")).toBeInTheDocument();
  });

  // A product tile the preview cannot draw is not a product: the block is
  // there, the product behind it is gone, and the box would be a notice
  // telling the seller so.
  it("counts a block whose product was deleted as no product at all", () => {
    renderCard(
      withMasthead([
        { ...productBlock, productId: MISSING_PRODUCT_ID },
        textBlock,
      ]),
    );
    expect(screen.queryByText(textBlock.text)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Product removed/),
    ).not.toBeInTheDocument();
  });

  // Same rule, the other way a tile disappears: hidden sold-out blocks are
  // dropped for buyers, so a card of them has nothing to show either.
  it("counts a hidden sold-out product as no product at all", () => {
    renderCard({
      ...withMasthead([{ ...productBlock, soldOut: true }, textBlock]),
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, hideSoldOut: true },
    });
    expect(screen.queryByText(textBlock.text)).not.toBeInTheDocument();
    expect(screen.getByText("This grid is empty")).toBeInTheDocument();
  });
});
