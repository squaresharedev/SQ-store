import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "../setup/render";
import type { Product } from "@/types/product";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  resolveCardStyle,
  type CardStyleOverrides,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import type { StorefrontPageData, StorefrontTileProduct } from "@/types/storefront-page";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { CardHoverControls } from "@/components/storefront/CardHoverControls";
import { CardShoppingControls } from "@/components/storefront/CardShoppingControls";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";
import { BlockTile } from "@/components/storefront/BlockTile";
import { StorefrontBoard } from "@/components/storefront-page/StorefrontBoard";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";
import { TextTileContent } from "@/components/storefront/TextTileContent";

/**
 * The card extras end to end below a browser: the controls a seller presses,
 * and what the real tile paths draw from what they store, on the designer's
 * tile and on a buyer's board.
 */

afterEach(cleanup);

let widthSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
});

afterAll(() => {
  widthSpy.mockRestore();
  vi.unstubAllGlobals();
});

const PRODUCT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const themed = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({
  ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
  ...over,
});

const baseProduct: Product = {
  id: PRODUCT_ID,
  title: "Speckled mug",
  description: "",
  price: 12.5,
  currency: "EUR",
  status: "active",
  imageUrl: "https://images.test.invalid/mug.jpg",
  hoverImageUrl: "https://images.test.invalid/mug-back.jpg",
  rating: { average: 4.6, count: 12 },
  digitalFileName: null,
  trackStock: true,
  stockQuantity: 2,
  lowStockThreshold: 3,
  maxPerOrder: 10,
};

const tile = { type: "product" as const, productId: PRODUCT_ID, x: 0, y: 0, w: 1, h: 1 };

function renderBoard(
  style: CardStyleOverrides,
  {
    product = baseProduct,
    theme = {},
    reviews = true,
  }: { product?: Product; theme?: Partial<StorefrontTheme>; reviews?: boolean } = {},
) {
  const config: StorefrontConfig = {
    ...structuredClone(DEFAULT_STOREFRONT_CONFIG),
    theme: themed({ columns: 2, rows: 2, cornerRadius: 0, titleDisplay: "always", ...theme }),
    blocks: [{ ...tile, style }],
    productPage: {
      ...DEFAULT_PRODUCT_PAGE_CONFIG,
      ...(reviews ? {} : { sections: [{ id: "reviews" as const, show: false }] }),
    },
  };
  return render(<StorefrontPreview config={config} productsById={new Map([[PRODUCT_ID, product]])} />);
}

describe("the hover controls", () => {
  it("emits only the field it changed", () => {
    const onChange = vi.fn();
    render(<CardHoverControls value={resolveCardStyle(themed())} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    expect(onChange).toHaveBeenLastCalledWith({ hoverEffect: "zoom" });
    fireEvent.click(screen.getByRole("switch", { name: "Second photo" }));
    expect(onChange).toHaveBeenLastCalledWith({ hoverPhoto: true });
  });
});

describe("the shopping controls", () => {
  const page = { ...DEFAULT_PRODUCT_PAGE_CONFIG, ctaLabel: "Get one", ctaColor: "#123456" };

  it("emits only the field it changed", () => {
    const onChange = vi.fn();
    render(<CardShoppingControls theme={themed()} productPage={page} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Buy button on the card" })).toBeInTheDocument();
    // Off: nothing about a button to set yet.
    expect(screen.queryByLabelText("Button text")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(onChange).toHaveBeenLastCalledWith({ buyButton: "outline" });
    fireEvent.click(screen.getByRole("switch", { name: "Star rating" }));
    expect(onChange).toHaveBeenLastCalledWith({ showRating: true });
    fireEvent.click(screen.getByRole("switch", { name: "Low stock" }));
    expect(onChange).toHaveBeenLastCalledWith({ showLowStock: true });
  });

  it("starts the button's words and colour as the product page's, and clearing hands them back", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CardShoppingControls theme={themed({ buyButton: "solid" })} productPage={page} onChange={onChange} />,
    );
    const words = screen.getByLabelText<HTMLInputElement>("Button text");
    expect(words.value).toBe("");
    expect(words.placeholder).toBe("Get one");
    fireEvent.change(words, { target: { value: "Grab it" } });
    expect(onChange).toHaveBeenLastCalledWith({ buyButtonLabel: "Grab it" });
    // The fill follows the page's button until the seller picks one.
    const pageDot = screen.getByRole("button", { name: "Use Product page button" });
    expect(pageDot).toHaveAttribute("aria-pressed", "true");
    expect(pageDot.style.backgroundColor).toBe("rgb(18, 52, 86)");
    expect(screen.getByRole("button", { name: "Use Auto" })).toHaveAttribute("aria-pressed", "true");

    rerender(
      <CardShoppingControls
        theme={themed({ buyButton: "solid", buyButtonLabel: "Grab it", buyButtonColor: "#0b3d2e" })}
        productPage={page}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Button text"), { target: { value: "  " } });
    expect(onChange).toHaveBeenLastCalledWith({ buyButtonLabel: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Use Product page button" }));
    expect(onChange).toHaveBeenLastCalledWith({ buyButtonColor: undefined });
  });

  it("falls back to the theme's cards on a tile, and offers a link only its words' colour", () => {
    render(
      <CardShoppingControls
        theme={themed({ buyButton: "link", buyButtonLabel: "Shop", buyButtonTextColor: "#c1121f" })}
        overrides={{}}
        productPage={page}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>("Button text").placeholder).toBe("Shop");
    expect(screen.queryByText("Button color")).toBeNull();
    expect(screen.getByRole("button", { name: "Use Theme color" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says why the stars do nothing while the product page shows no reviews", () => {
    render(
      <CardShoppingControls
        theme={themed()}
        productPage={{ ...DEFAULT_PRODUCT_PAGE_CONFIG, sections: [{ id: "reviews", show: false }] }}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Where the stars come from" }));
    expect(screen.getAllByText(/Reviews are off on your product page/).length).toBeGreaterThan(0);
  });
});

describe("a card's second photo and hover effect", () => {
  it("lays the second photo over the first only when asked for and there is one", () => {
    const { container } = renderBoard({ hoverPhoto: true });
    const hover = container.querySelector<HTMLImageElement>("[data-tile-hover-photo]");
    expect(hover?.getAttribute("src")).toBe(baseProduct.hoverImageUrl);
    expect(hover).toHaveAttribute("aria-hidden", "true");
    expect(hover).toHaveAttribute("loading", "lazy");
    cleanup();

    renderBoard({});
    expect(document.querySelector("[data-tile-hover-photo]")).toBeNull();
    cleanup();

    // A product with no cover keeps its placeholder: no photo on hover alone.
    renderBoard({ hoverPhoto: true }, { product: { ...baseProduct, imageUrl: null } });
    expect(document.querySelector("[data-tile-hover-photo]")).toBeNull();
  });

  it("zooms the photo inside its frame, which then clips it", () => {
    const { container } = renderBoard({ hoverEffect: "zoom", hoverPhoto: true });
    const frame = container.querySelector<HTMLElement>("[data-image-frame]")!;
    expect(frame.className).toContain("overflow-hidden");
    for (const img of frame.querySelectorAll("img")) {
      expect(img.className).toContain("motion-safe:group-hover:scale-105");
    }
  });

  it("lifts the whole card from its frame, and nothing moves without an effect", () => {
    const { container } = renderBoard({ hoverEffect: "lift" });
    expect(container.innerHTML).toContain("motion-safe:group-hover:-translate-y-1");
    cleanup();
    const plain = renderBoard({});
    expect(plain.container.innerHTML).not.toContain("group-hover:-translate-y-1");
    expect(plain.container.querySelector("[data-image-frame]")!.className).not.toContain("overflow-hidden");
  });

  it("plays on the selected card in the designer, on the pointer and never on focus", () => {
    const block: StorefrontBlock = { ...tile, style: { hoverEffect: "tilt", hoverPhoto: true } };
    const { container, rerender } = render(
      <BlockTile blockKey="p" block={block} product={baseProduct} theme={themed()} editable isEditing />,
    );
    // A seller tries the effect by pointing at the card they are styling...
    expect(container.innerHTML).toContain("motion-safe:group-hover:rotate-1");
    expect(container.querySelector("[data-tile-hover-photo]")!.className).toContain("group-hover:opacity-100");
    // ...and the focus a selected tile holds does not keep it tipped.
    expect(container.innerHTML).not.toContain("group-focus-within:rotate-1");
    expect(container.querySelector("[data-tile-hover-photo]")!.className).not.toContain("group-focus-within:");

    // Still while the grid carries or resizes it.
    rerender(<BlockTile blockKey="p" block={block} product={baseProduct} theme={themed()} editable isEditing isGesture />);
    expect(container.innerHTML).not.toContain("group-hover:rotate-1");
    expect(container.querySelector("[data-tile-hover-photo]")!.className).not.toContain("group-hover:");
  });
});

describe("a card's stars and stock line", () => {
  it("prints the rating under the name, and says it in full to a screen reader", () => {
    renderBoard({ showRating: true });
    const rating = document.querySelector<HTMLElement>("[data-tile-rating]")!;
    expect(rating.textContent).toContain("4.6");
    expect(rating.textContent).toContain("(12)");
    expect(within(rating).getByText("4.6 out of 5 stars, 12 reviews")).toHaveClass("sr-only");
    // Under the name, in the same band.
    const band = document.querySelector("[data-title-band]")!;
    expect(band.contains(rating)).toBe(true);
    expect(within(band as HTMLElement).getByText("Speckled mug")).toBeInTheDocument();
  });

  it("shows no stars for a product nobody reviewed, or while the page shows no reviews", () => {
    renderBoard({ showRating: true }, { product: { ...baseProduct, rating: undefined } });
    expect(document.querySelector("[data-tile-rating]")).toBeNull();
    cleanup();
    renderBoard({ showRating: true }, { reviews: false });
    expect(document.querySelector("[data-tile-rating]")).toBeNull();
  });

  it("says Low stock without a number, and Sold out once none are left", () => {
    renderBoard({ showLowStock: true });
    const low = document.querySelector<HTMLElement>("[data-tile-low-stock]")!;
    expect(low.textContent).toBe("Low stock");
    // Nothing anywhere on the card says how many: 2 is on the shelf.
    expect(document.querySelector("[data-title-band]")!.textContent).not.toMatch(/\b2\b/);
    cleanup();

    renderBoard({ showLowStock: true }, { product: { ...baseProduct, stockQuantity: 0 } });
    expect(document.querySelector("[data-tile-low-stock]")).toBeNull();
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    cleanup();

    // Off, the same stock says nothing.
    renderBoard({}, { product: { ...baseProduct, stockQuantity: 0 } });
    expect(screen.queryByText("Sold out")).toBeNull();
    expect(document.querySelector("[data-tile-low-stock]")).toBeNull();
  });

  it("keeps the line with the title hidden, in a band of its own", () => {
    renderBoard({ showRating: true, showTitle: false, priceTagPosition: "top-right" });
    expect(document.querySelector("[data-tile-rating]")).not.toBeNull();
    expect(screen.queryByText("Speckled mug")).toBeNull();
  });
});

describe("a card's buy button", () => {
  it("draws the product page's button at the foot of the card, in its look", () => {
    renderBoard({ buyButton: "solid" });
    const row = document.querySelector<HTMLElement>("[data-tile-buy]")!;
    expect(row.dataset.tileBuy).toBe("solid");
    expect(row.textContent).toBe(DEFAULT_PRODUCT_PAGE_CONFIG.ctaLabel);
    // Below the photo, never on it.
    expect(document.querySelector("[data-image-frame]")!.contains(row)).toBe(false);
    // With its arrow, which a screen reader does not read out, stepping right
    // on a buyer's pointer or focus.
    const arrow = row.querySelector("[data-tile-buy-arrow]")!;
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(arrow.getAttribute("class")).toContain("motion-safe:group-hover:translate-x-0.5");
    expect(arrow.getAttribute("class")).toContain("motion-safe:group-focus-within:translate-x-0.5");
    cleanup();

    renderBoard({ buyButton: "link" });
    expect(document.querySelector<HTMLElement>("[data-tile-buy]")!.dataset.tileBuy).toBe("link");
  });

  it("says the seller's own words in the seller's own colours, a tile's over the theme's", () => {
    renderBoard(
      { buyButtonColor: "#0b3d2e" },
      { theme: { buyButton: "solid", buyButtonLabel: "Grab it", buyButtonTextColor: "#ffd166" } },
    );
    const button = document.querySelector<HTMLElement>("[data-tile-buy] > span")!;
    expect(button.textContent).toBe("Grab it");
    expect(button.style.backgroundColor).toBe("rgb(11, 61, 46)");
    expect(button.style.color).toBe("rgb(255, 209, 102)");
    cleanup();

    // Long words give way to the arrow rather than pushing it off the card.
    renderBoard({ buyButton: "outline", buyButtonLabel: "x".repeat(24) });
    const label = document.querySelector("[data-tile-buy] > span > span")!;
    expect(label.className).toContain("truncate");
    expect(document.querySelector("[data-tile-buy-arrow]")!.getAttribute("class")).toContain("shrink-0");
  });

  it("is not drawn on a sold-out card, or with the button off", () => {
    renderBoard({ buyButton: "outline", showLowStock: true }, { product: { ...baseProduct, stockQuantity: 0 } });
    expect(document.querySelector("[data-tile-buy]")).toBeNull();
    cleanup();
    // With Low stock off as well: no badge goes up, but nothing is offered.
    renderBoard({ buyButton: "outline" }, { product: { ...baseProduct, stockQuantity: 0 } });
    expect(document.querySelector("[data-tile-buy]")).toBeNull();
    expect(screen.queryByText("Sold out")).toBeNull();
    cleanup();
    // The seller's own sold-out mark takes it away too.
    render(
      <StorefrontPreview
        config={{
          ...structuredClone(DEFAULT_STOREFRONT_CONFIG),
          theme: themed({ columns: 2, rows: 2, hideSoldOut: false }),
          blocks: [{ ...tile, soldOut: true, style: { buyButton: "solid" } }],
        }}
        productsById={new Map([[PRODUCT_ID, { ...baseProduct, trackStock: false, stockQuantity: null }]])}
      />,
    );
    expect(document.querySelector("[data-tile-buy]")).toBeNull();
    cleanup();
    renderBoard({ buyButton: "none" });
    expect(document.querySelector("[data-tile-buy]")).toBeNull();
  });
});

describe("the buyer's board", () => {
  function page(extras: Partial<StorefrontTileProduct>, theme: Partial<StorefrontTheme>): StorefrontPageData {
    const t = themed({ columns: 2, rows: 2, titleDisplay: "always", ...theme });
    return {
      id: "sf",
      name: "Shop",
      theme: t,
      blocks: [tile],
      products: [
        {
          id: PRODUCT_ID,
          title: "Speckled mug",
          price: 12.5,
          currency: "EUR",
          imageUrl: "https://images.test.invalid/mug.jpg",
          href: "/s/sf/p/mug",
          ...extras,
        },
      ],
      tileLook: resolveTileLook({ theme: t, productPage: DEFAULT_PRODUCT_PAGE_CONFIG }),
      imageUrls: {},
      backgroundImageUrl: null,
      customFontUrl: null,
      // The board draws no footer, so the trader is never read here.
      seller: {} as StorefrontPageData["seller"],
      allowIndexing: false,
      url: "https://example.test/s/sf",
    };
  }

  it("draws what the server sent, on the card's one link", () => {
    render(
      <StorefrontBoard
        page={page(
          { hoverImageUrl: "https://images.test.invalid/b.jpg", rating: { average: 4, count: 3 }, stockState: "low_stock" },
          { hoverEffect: "lift", hoverPhoto: true, showRating: true, showLowStock: true, buyButton: "solid" },
        )}
        displayName="Shop"
      />,
    );
    const link = document.querySelector<HTMLAnchorElement>("a[data-storefront-tile]")!;
    expect(link.className).toContain("motion-safe:group-hover:-translate-y-1");
    // One link, with everything inside it: no link in a link.
    expect(link.querySelectorAll("a")).toHaveLength(0);
    expect(link.querySelector("[data-tile-hover-photo]")).not.toBeNull();
    expect(link.querySelector("[data-tile-rating]")).not.toBeNull();
    expect(link.querySelector("[data-tile-low-stock]")?.textContent).toBe("Low stock");
    expect(link.querySelector("[data-tile-buy]")?.textContent).toBe(DEFAULT_PRODUCT_PAGE_CONFIG.ctaLabel);
  });

  it("draws the button's own words, colours and arrow, as the hosted page and the assistant's preview do", () => {
    render(
      <StorefrontBoard
        page={page({}, { buyButton: "solid", buyButtonLabel: "Grab it", buyButtonColor: "#0b3d2e", buyButtonTextColor: "#ffd166" })}
        displayName="Shop"
      />,
    );
    const button = document.querySelector<HTMLElement>("a[data-storefront-tile] [data-tile-buy] > span")!;
    expect(button.textContent).toBe("Grab it");
    expect(button.style.backgroundColor).toBe("rgb(11, 61, 46)");
    expect(button.style.color).toBe("rgb(255, 209, 102)");
    expect(button.querySelector("svg[data-tile-buy-arrow]")).not.toBeNull();
  });

  it("turns a sold-out state into the sold-out badge", () => {
    render(<StorefrontBoard page={page({ stockState: "sold_out" }, { showLowStock: true })} displayName="Shop" />);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });
});

describe("text spacing", () => {
  const text: StorefrontBlock & { type: "text" } = {
    type: "text",
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    text: "Wide words",
    variant: "body",
    align: "left",
    x: 0,
    y: 0,
    w: 2,
    h: 1,
  };

  it("spaces the words as stored, and leaves them alone otherwise", () => {
    render(<TextTileContent block={{ ...text, letterSpacing: 20, lineHeight: 180 }} theme={themed()} />);
    const words = screen.getByText("Wide words").closest<HTMLElement>("[style]")!;
    expect(words.style.letterSpacing).toBe("0.2em");
    expect(words.style.lineHeight).toBe("1.8");
    cleanup();
    render(<TextTileContent block={text} theme={themed()} />);
    const plain = screen.getByText("Wide words").closest<HTMLElement>("[style]")!;
    expect(plain.style.letterSpacing).toBe("");
    expect(plain.style.lineHeight).toBe("1.25");
  });

  it("offers both sliders, reading Normal at rest, and stores nothing back at Normal", () => {
    const onUpdate = vi.fn();
    const { rerender } = render(<TextBlockEditor block={text} accent="#171717" onUpdate={onUpdate} onDuplicate={() => {}} />);
    const letters = screen.getByRole("slider", { name: "Letter spacing" });
    const lines = screen.getByRole("slider", { name: "Line height" });
    expect(letters).toHaveAttribute("aria-valuetext", "Normal");
    expect(lines).toHaveAttribute("aria-valuetext", "Normal");
    fireEvent.keyDown(letters, { key: "ArrowRight" });
    expect(onUpdate).toHaveBeenLastCalledWith({ letterSpacing: 1 });
    fireEvent.keyDown(lines, { key: "ArrowRight" });
    expect(onUpdate).toHaveBeenLastCalledWith({ lineHeight: 130 });

    rerender(
      <TextBlockEditor block={{ ...text, letterSpacing: 1 }} accent="#171717" onUpdate={onUpdate} onDuplicate={() => {}} />,
    );
    expect(screen.getByRole("slider", { name: "Letter spacing" })).toHaveAttribute(
      "aria-valuetext",
      "1 percent of the type size",
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "Letter spacing" }), { key: "ArrowLeft" });
    expect(onUpdate).toHaveBeenLastCalledWith({ letterSpacing: undefined });
  });
});
