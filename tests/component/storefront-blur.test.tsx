import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "../setup/render";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  resolveCardStyle,
  type CardStyleOverrides,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { CardStyleControls } from "@/components/storefront/CardStyleControls";
import { ShapeBlockEditor } from "@/components/storefront/ShapeBlockEditor";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";

/**
 * Blur end to end: the sliders a seller drags, and what the real tile render
 * path paints from the values they store.
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

const product: Product = {
  id: PRODUCT_ID,
  title: "Frosted mug",
  description: "",
  price: 12.5,
  currency: "EUR",
  status: "active",
  imageUrl: "https://images.test.invalid/mug.jpg",
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
  maxPerOrder: 10,
};

const shape: StorefrontBlock & { type: "shape" } = {
  type: "shape",
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "circle",
  color: "#171717",
  x: 1,
  y: 0,
  w: 1,
  h: 1,
};

const text: StorefrontBlock & { type: "text" } = {
  type: "text",
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  text: "Soft words",
  variant: "body",
  align: "left",
  x: 0,
  y: 1,
  w: 2,
  h: 1,
};

function slider(name: string) {
  return screen.getByRole("slider", { name });
}

describe("card blur controls", () => {
  function renderControls(overrides: CardStyleOverrides) {
    const onChange = vi.fn();
    render(
      <CardStyleControls
        value={resolveCardStyle(themed(), overrides)}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it("offers the shadow blur only while a shadow is drawn, and photo blur always", () => {
    renderControls({ titleStyle: "bar" });
    expect(screen.queryByRole("slider", { name: "Shadow blur" })).toBeNull();
    expect(slider("Photo blur")).toBeInTheDocument();
    cleanup();

    renderControls({ titleStyle: "shadow", showTitle: true });
    expect(slider("Shadow blur")).toBeInTheDocument();
    expect(slider("Photo blur")).toBeInTheDocument();
  });

  it("reads Off at zero and emits only the field it changed", () => {
    const onChange = renderControls({ titleStyle: "shadow", showTitle: true });
    expect(slider("Shadow blur")).toHaveAttribute("aria-valuetext", "Off");

    fireEvent.keyDown(slider("Shadow blur"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ titleShadowBlur: 5 });

    fireEvent.keyDown(slider("Photo blur"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ photoBlur: 5 });
  });
});

describe("block blur controls", () => {
  it("gives a shape a blur slider that writes the shape's blur", () => {
    const onUpdate = vi.fn();
    render(
      <ShapeBlockEditor
        block={{ ...shape, blur: 40 }}
        onUpdate={onUpdate}
        onDuplicate={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(slider("Blur")).toHaveAttribute("aria-valuetext", "40 out of 100");
    fireEvent.keyDown(slider("Blur"), { key: "ArrowRight" });
    expect(onUpdate).toHaveBeenLastCalledWith({ blur: 45 });
  });

  it("asks which way the blur runs only once there is one, and writes it", () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <ShapeBlockEditor block={shape} onUpdate={onUpdate} onDuplicate={() => {}} onRemove={() => {}} />,
    );
    // Sharp: nothing to steer, so no direction row at all.
    expect(screen.queryByRole("group", { name: "Blur direction" })).toBeNull();

    rerender(
      <ShapeBlockEditor
        block={{ ...shape, blur: 30 }}
        onUpdate={onUpdate}
        onDuplicate={() => {}}
        onRemove={() => {}}
      />,
    );
    const group = screen.getByRole("group", { name: "Blur direction" });
    // All over until the seller says otherwise, and the choice is named.
    expect(screen.getByRole("button", { name: "All over" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("All over").length).toBeGreaterThan(0);
    expect(group.querySelectorAll("button")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "From the bottom" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ blurDirection: "bottom" });
  });

  it("gives the photo blur a direction, and the shadow blur none", () => {
    const onChange = vi.fn();
    render(
      <CardStyleControls
        value={resolveCardStyle(themed(), { titleStyle: "shadow", showTitle: true, photoBlur: 20, titleShadowBlur: 20 })}
        onChange={onChange}
      />,
    );
    // One direction row: the photo's. The fade's frost runs with the fade.
    expect(screen.getAllByRole("group", { name: "Blur direction" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "From the left" }));
    expect(onChange).toHaveBeenLastCalledWith({ photoBlurDirection: "left" });
  });

  it("gives a text block one too", () => {
    const onUpdate = vi.fn();
    render(
      <TextBlockEditor
        block={text}
        accent="#171717"
        onUpdate={onUpdate}
        onDuplicate={() => {}}
      />,
    );
    fireEvent.keyDown(slider("Blur"), { key: "ArrowRight" });
    expect(onUpdate).toHaveBeenLastCalledWith({ blur: 5 });
  });
});

describe("blur on the rendered board", () => {
  function renderBoard(blocks: StorefrontBlock[], theme: Partial<StorefrontTheme> = {}) {
    const config: StorefrontConfig = {
      ...structuredClone(DEFAULT_STOREFRONT_CONFIG),
      theme: themed({ columns: 2, rows: 2, cornerRadius: 0, ...theme }),
      blocks,
    };
    return render(
      <StorefrontPreview config={config} productsById={new Map([[PRODUCT_ID, product]])} />,
    );
  }

  const tile = { type: "product" as const, productId: PRODUCT_ID, x: 0, y: 0, w: 1, h: 1 };

  it("blurs a shape's and a text block's whole face, and leaves a sharp one alone", () => {
    const { container } = renderBoard([{ ...shape, blur: 30 }, text]);
    const faces = [...container.querySelectorAll<HTMLElement>("[data-grid-cell] .overflow-hidden")];
    const filters = faces.map((face) => face.style.filter).filter(Boolean);
    // Exactly one blurred face: the shape. The text block is untouched.
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatch(/^blur\(calc\(/);
    expect(screen.getByText("Soft words").closest<HTMLElement>("[style*='blur']")).toBeNull();
  });

  it("lays a half-blurred and a sharp copy over a block blurred from one edge, and only then", () => {
    const { container } = renderBoard([
      { ...shape, blur: 30, blurDirection: "bottom" },
      { ...text, blur: 30 },
    ]);
    const copies = [...container.querySelectorAll<HTMLElement>("[data-blur-copy]")];
    // The shape blurred from the bottom has two; the text blurred all over has none.
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy).toHaveAttribute("aria-hidden", "true");
      // (jsdom spells the colour out, so the direction is what is checked.)
      expect(copy.style.maskImage.startsWith("linear-gradient(to top, ")).toBe(true);
    }
    // Half blur first, then the sharp one on top.
    expect(copies[0].style.filter).toMatch(/^blur\(calc\(/);
    expect(copies[1].style.filter).toBe("");
  });

  it("lays a backdrop blur over a product photo, under its labels", () => {
    const { container } = renderBoard([{ ...tile, style: { photoBlur: 25 } }]);
    const frame = container.querySelector<HTMLElement>("[data-image-frame]")!;
    const layer = [...frame.querySelectorAll<HTMLElement>("span[aria-hidden='true']")].find(
      (el) => el.style.backdropFilter,
    );
    expect(layer).toBeDefined();
    // The photo itself carries no filter, so its edges stay solid.
    expect(frame.querySelector("img")!.style.filter).toBe("");
  });

  it("frosts the shadow fade behind the name, and only on a shadow", () => {
    renderBoard([
      {
        ...tile,
        style: { titleStyle: "shadow", showTitle: true, priceTagPosition: "hidden", titleShadowBlur: 40 },
      },
    ]);
    const band = screen.getByText("Frosted mug").closest<HTMLElement>("[data-title-band]")!;
    // Beside the band, not inside it: a band fading in by opacity would hide
    // a frost drawn inside it for the whole fade.
    const frost = band.previousElementSibling as HTMLElement | null;
    expect(frost?.style.backdropFilter).toMatch(/^blur\(/);
    expect(band.contains(frost)).toBe(false);
    cleanup();

    renderBoard([
      { ...tile, style: { titleStyle: "bar", showTitle: true, priceTagPosition: "hidden", titleShadowBlur: 40 } },
    ]);
    const bar = screen.getByText("Frosted mug").closest<HTMLElement>("[data-title-band]")!;
    expect(
      [...bar.querySelectorAll<HTMLElement>("span")].some((el) => el.style.backdropFilter),
    ).toBe(false);
  });
});
