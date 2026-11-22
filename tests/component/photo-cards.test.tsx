import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "../setup/render";
import type { Product } from "@/types/product";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  resolveCardStyle,
  type CardStyleOverrides,
  type ImageBlock,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { ProductTileContent } from "@/components/storefront/ProductTileContent";
import { ImageTileContent } from "@/components/storefront/ImageTileContent";
import { ImageBlockEditor } from "@/components/storefront/ImageBlockEditor";
import { ShapeBlockEditor } from "@/components/storefront/ShapeBlockEditor";
import { CardStyleControls } from "@/components/storefront/CardStyleControls";
import { CardsSection } from "@/components/storefront/CardsSection";
import { StorefrontBoard } from "@/components/storefront-page/StorefrontBoard";
import { shadowFilter } from "@/components/storefront/config-maps";

/**
 * PHOTO CARDS, DRAWN AND EDITED (editor upgrade, workstream 1): what a card
 * with a colour, a blend, a name strip, a photo shape or a shadow draws, on
 * its own and through a buyer's board, and the controls that set them.
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

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({
  ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
  ...over,
});

const PRODUCT: Product = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  title: "Speckled mug",
  description: "",
  price: 12.5,
  currency: "EUR",
  status: "active",
  imageUrl: "https://images.test.invalid/mug.jpg",
  hoverImageUrl: "https://images.test.invalid/mug-b.jpg",
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
  maxPerOrder: 10,
};

function tile(over: Partial<StorefrontTheme>, overrides?: CardStyleOverrides, photoEdge?: "white" | "other") {
  const { container } = render(
    <ProductTileContent product={PRODUCT} theme={theme(over)} overrides={overrides} photoEdge={photoEdge} />,
  );
  const photo = container.querySelector<HTMLImageElement>("[data-image-frame] > img")!;
  const frame = container.querySelector<HTMLElement>("[data-image-frame]")!;
  const band = container.querySelector<HTMLElement>("[data-title-band]")!;
  const name = screen.getByText("Speckled mug");
  return { container, photo, frame, band, name };
}

describe("a card with a colour of its own", () => {
  it("paints its frame and its strip, and prints the name in an ink that reads there", () => {
    const { frame, band, name } = tile({ cardColor: "#14532d" });
    expect(frame).not.toHaveClass("bg-muted");
    expect(frame.style.backgroundColor).toBe("rgb(20, 83, 45)");
    expect(band).not.toHaveClass("bg-card");
    expect(band.style.backgroundColor).toBe("rgb(20, 83, 45)");
    expect(name).not.toHaveClass("text-foreground");
    expect(name.style.color).toBe("rgb(255, 255, 255)");
  });

  it("keeps an overlay strip see-through in its own colour", () => {
    const { band } = tile({ titleStyle: "overlay", titleBarColor: "#fef3c7" });
    expect(band).not.toHaveClass("bg-card/90");
    expect(band.style.backgroundColor).toBe("rgba(254, 243, 199, 0.9)");
  });

  it("sets the name in the pairing's headline face when asked", () => {
    const { name } = tile({ titleFont: "heading" });
    expect(name.style.fontFamily).toBe("var(--ss-font-heading, inherit)");
    // Still the old class ink: only the face was asked for.
    expect(name).toHaveClass("text-foreground");
  });

  it("paints its buy row in its colour too", () => {
    const { container } = tile({ cardColor: "#fef3c7", buyButton: "solid" });
    const foot = container.querySelector<HTMLElement>("[data-tile-buy]")!;
    expect(foot).not.toHaveClass("bg-card");
    expect(foot.style.backgroundColor).toBe("rgb(254, 243, 199)");
  });
});

describe("blending a white background", () => {
  it("multiplies the photo into the card only where the setting and the photo agree", () => {
    expect(tile({ cardColor: "#fef3c7", whiteBlend: "auto" }, undefined, "white").photo).toHaveClass("mix-blend-multiply");
    cleanup();
    expect(tile({ cardColor: "#fef3c7", whiteBlend: "auto" }, undefined, "other").photo).not.toHaveClass("mix-blend-multiply");
    cleanup();
    // Not measured: left alone, never blended on a guess.
    expect(tile({ cardColor: "#fef3c7", whiteBlend: "auto" }).photo).not.toHaveClass("mix-blend-multiply");
    cleanup();
    expect(tile({ cardColor: "#fef3c7", whiteBlend: "on" }).photo).toHaveClass("mix-blend-multiply");
    cleanup();
    expect(tile({ cardColor: "#1c1917", whiteBlend: "on" }).photo).not.toHaveClass("mix-blend-multiply");
  });

  it("reaches the face from the block's cached edge on a buyer's board", () => {
    const block: ProductBlock = { type: "product", productId: PRODUCT.id, x: 0, y: 0, w: 1, h: 1, photoEdge: "white" };
    const t = theme({ columns: 2, rows: 1, cardColor: "#fef3c7", whiteBlend: "auto", shadow: "soft" });
    const page: StorefrontPageData = {
      id: "sf",
      name: "Shop",
      theme: t,
      blocks: [block],
      products: [{ id: PRODUCT.id, title: PRODUCT.title, price: 12.5, currency: "EUR", imageUrl: PRODUCT.imageUrl, href: "/p" }],
      tileLook: resolveTileLook({ theme: t, productPage: DEFAULT_PRODUCT_PAGE_CONFIG }),
      imageUrls: {},
      backgroundImageUrl: null,
      customFontUrl: null,
      seller: {} as StorefrontPageData["seller"],
      allowIndexing: false,
      url: "https://example.test/s/sf",
    };
    render(<StorefrontBoard page={page} displayName="Shop" />);
    const link = document.querySelector<HTMLElement>("a[data-storefront-tile]")!;
    expect(link.querySelector("[data-image-frame] > img")).toHaveClass("mix-blend-multiply");
    // The card's shadow is drawn by its cell, outside the face's clip.
    expect(link.closest("li")!.style.filter).toBe(shadowFilter("soft"));
  });
});

describe("FIX: a shadow title over a white photo", () => {
  it("fades pale with dark words instead of a muddy grey smudge", () => {
    const { band, name } = tile({ titleStyle: "shadow" }, undefined, "white");
    expect(band.style.backgroundImage).toContain("rgba(255, 255, 255");
    expect(name.style.color).toBe("rgb(23, 23, 23)");
    expect(name).not.toHaveClass("drop-shadow-sm");
  });

  it("keeps the dark fade over any other photo", () => {
    const { band, name } = tile({ titleStyle: "shadow" }, undefined, "other");
    expect(band.style.backgroundImage).toContain("rgba(0, 0, 0");
    expect(name.style.color).toBe("rgb(255, 255, 255)");
  });
});

describe("photo shapes", () => {
  it("cut the card's photo, its second photo and its blur alike", () => {
    const { container, photo, frame } = tile({ photoShape: "arch", hoverPhoto: true, photoBlur: 20 });
    expect(photo.style.clipPath).toContain("inset(6cqmin");
    // The frame round a shaped photo is the card's white, not the old grey.
    expect(frame.style.backgroundColor).toBe("rgb(255, 255, 255)");
    fireEvent.pointerEnter(frame.parentElement!);
    expect(container.querySelector<HTMLElement>("[data-tile-hover-photo]")!.style.clipPath).toContain("inset(6cqmin");
    expect(container.querySelector<HTMLElement>("[data-image-frame] > span[aria-hidden]")!.style.clipPath).toContain("inset(6cqmin");
  });

  it("cut an image block's picture and leave an unshaped one's style alone", () => {
    const block: ImageBlock = { type: "image", id: "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc", key: "elements/a/b-c.png", alt: "Logo", x: 0, y: 0, w: 1, h: 1 };
    render(<ImageTileContent block={{ ...block, shape: "rounded" }} src="https://images.test.invalid/logo.png" />);
    expect(screen.getByAltText("Logo").style.clipPath).toContain("round calc(");
    cleanup();
    render(<ImageTileContent block={block} src="https://images.test.invalid/logo.png" />);
    expect(screen.getByAltText("Logo").getAttribute("style")).toBeNull();
  });
});

describe("the card look's controls", () => {
  it("puts card colour and the blend in the open, and the rest behind More", async () => {
    const onChange = vi.fn();
    const t = theme({ fontPairing: "modern" });
    render(<CardStyleControls value={resolveCardStyle(t)} onChange={onChange} colorScope={{ theme: t, scope: "theme" }} />);
    expect(screen.getByText("Card color")).toBeVisible();
    const blend = screen.getByRole("group", { name: "Blend white background" });
    expect(within(blend).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(blend).getByRole("button", { name: "Auto" }));
    expect(onChange).toHaveBeenLastCalledWith({ whiteBlend: "auto" });

    expect(screen.queryByRole("group", { name: "Photo shape" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Shadow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByText("Name strip")).toBeVisible();
    expect(screen.getByText("Name color")).toBeVisible();
    fireEvent.click(within(screen.getByRole("group", { name: "Name font" })).getByRole("button", { name: "Headline" }));
    expect(onChange).toHaveBeenLastCalledWith({ titleFont: "heading" });
    fireEvent.click(within(screen.getByRole("group", { name: "Photo shape" })).getByRole("button", { name: "Circle" }));
    expect(onChange).toHaveBeenLastCalledWith({ photoShape: "circle" });
    fireEvent.click(within(screen.getByRole("group", { name: "Shadow" })).getByRole("button", { name: "Lifted" }));
    expect(onChange).toHaveBeenLastCalledWith({ shadow: "lifted" });
  });

  it("offers the name font only under a font pairing, where there are two faces", () => {
    const t = theme();
    render(<CardStyleControls value={resolveCardStyle(t)} onChange={vi.fn()} colorScope={{ theme: t, scope: "theme" }} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("group", { name: "Name font" })).toBeNull();
  });

  it("on the theme, stores nothing for a choice that is the default", () => {
    const onChange = vi.fn();
    const t = theme({ whiteBlend: "auto", shadow: "soft", photoShape: "arch" });
    render(<CardsSection theme={t} onChange={onChange} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Blend white background" })).getByRole("button", { name: "Off" }));
    expect(onChange.mock.lastCall![0]).not.toHaveProperty("whiteBlend");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Shadow" })).getByRole("button", { name: "None" }));
    expect(onChange.mock.lastCall![0]).not.toHaveProperty("shadow");
    fireEvent.click(within(screen.getByRole("group", { name: "Photo shape" })).getByRole("button", { name: "Rectangle" }));
    expect(onChange.mock.lastCall![0]).not.toHaveProperty("photoShape");
  });

  it("on a tile, keeps a choice even when it matches the theme, so the tile stops following it", () => {
    const onChange = vi.fn();
    const t = theme({ whiteBlend: "auto" });
    render(
      <CardStyleControls
        value={resolveCardStyle(t, { whiteBlend: "on" })}
        onChange={onChange}
        colorScope={{ theme: t, overrides: { whiteBlend: "on" }, scope: { blockKey: "p_x" } }}
      />,
    );
    fireEvent.click(within(screen.getByRole("group", { name: "Blend white background" })).getByRole("button", { name: "Off" }));
    expect(onChange).toHaveBeenLastCalledWith({ whiteBlend: "off" });
  });

  it("says why a dark card does not blend", () => {
    const t = theme({ cardColor: "#1c1917", whiteBlend: "on" });
    render(<CardStyleControls value={resolveCardStyle(t)} onChange={vi.fn()} colorScope={{ theme: t, scope: "theme" }} />);
    expect(screen.getByText(/keep their white on a dark card/)).toBeInTheDocument();
  });

  it("clears the card colour back to the default with its inherit dot", () => {
    const onChange = vi.fn();
    const t = theme({ cardColor: "#fef3c7" });
    render(<CardsSection theme={t} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Use Default" })[0]);
    expect(onChange.mock.lastCall![0]).not.toHaveProperty("cardColor");
  });
});

describe("shape and shadow on image and shape blocks", () => {
  const image: ImageBlock = { type: "image", id: "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc", key: "elements/a/b-c.png", alt: "", x: 0, y: 0, w: 1, h: 1 };
  const shape: ShapeBlock = { type: "shape", id: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb", kind: "circle", color: "#fbbf24", x: 0, y: 0, w: 1, h: 1 };

  it("offers an image its shape and its shadow, each back to nothing at the default", () => {
    const onUpdate = vi.fn();
    render(
      <ImageBlockEditor block={{ ...image, shape: "arch", shadow: "soft" }} canFrame onUpdate={onUpdate} onFrame={vi.fn()} onDuplicate={vi.fn()} onRemove={vi.fn()} />,
    );
    fireEvent.click(within(screen.getByRole("group", { name: "Shape" })).getByRole("button", { name: "Circle" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ shape: "circle" });
    fireEvent.click(within(screen.getByRole("group", { name: "Shape" })).getByRole("button", { name: "Rectangle" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ shape: undefined });
    fireEvent.click(within(screen.getByRole("group", { name: "Shadow" })).getByRole("button", { name: "None" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ shadow: undefined });
  });

  it("offers a shape its shadow", () => {
    const onUpdate = vi.fn();
    render(<ShapeBlockEditor block={shape} onUpdate={onUpdate} onDuplicate={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Shadow" })).getByRole("button", { name: "Soft" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ shadow: "soft" });
  });
});
