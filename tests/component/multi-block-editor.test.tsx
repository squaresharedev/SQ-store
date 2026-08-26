import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontBlock,
  type TextBlock,
} from "@/types/storefront";
import { MultiBlockEditor } from "@/components/storefront/MultiBlockEditor";

/**
 * The group editor's contract: same-type selections get their full settings
 * (through the same editors the single selection uses, values from the first
 * block, patches to the whole selection via the designer); mixed selections
 * get group actions only. The designer-side fan-out (one patch to N blocks)
 * is covered end to end in tests/e2e/03-storefront.spec.ts.
 */

afterEach(cleanup);

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function shapeBlock(kind: ShapeBlock["kind"], x: number): ShapeBlock {
  return { type: "shape", id: uid(), kind, color: "#171717", x, y: 0, w: 1, h: 1 };
}

function textBlock(x: number): TextBlock {
  return {
    type: "text",
    id: uid(),
    text: `text ${x}`,
    variant: "heading",
    align: "left",
    x,
    y: 1,
    w: 1,
    h: 1,
  };
}

function productBlock(x: number, style?: ProductBlock["style"]): ProductBlock {
  return {
    type: "product",
    productId: uid(),
    x,
    y: 2,
    w: 1,
    h: 1,
    ...(style ? { style } : {}),
  };
}

function renderMulti(blocks: StorefrontBlock[]) {
  const callbacks = {
    onProductStyleChange: vi.fn(),
    onProductStyleReset: vi.fn(),
    onShapeChange: vi.fn(),
    onTextChange: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
  };
  render(
    <MultiBlockEditor
      blocks={blocks}
      theme={DEFAULT_STOREFRONT_CONFIG.theme}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe("MultiBlockEditor", () => {
  it("all shapes: full shape settings, patches routed to the group", async () => {
    const user = userEvent.setup();
    const callbacks = renderMulti([shapeBlock("star", 0), shapeBlock("hexagon", 1)]);
    // The full shape editor is present (kind grid + sliders).
    await user.click(screen.getByRole("button", { name: "Circle" }));
    expect(callbacks.onShapeChange).toHaveBeenCalledWith({ kind: "circle" });
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(callbacks.onDuplicate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(callbacks.onRemove).toHaveBeenCalledTimes(1);
  });

  it("all texts: settings without the content field", async () => {
    const user = userEvent.setup();
    const callbacks = renderMulti([textBlock(0), textBlock(1)]);
    // No textarea: one string must never overwrite several blocks' text.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(callbacks.onTextChange).toHaveBeenCalledWith({ bold: true });
    expect(
      screen.getByRole("button", { name: /remove 2 blocks/i }),
    ).toBeInTheDocument();
  });

  it("all products: shared card + price tag controls, reset when any overrides", async () => {
    const user = userEvent.setup();
    const callbacks = renderMulti([
      productBlock(0, { cornerRadius: 100 }),
      productBlock(1),
    ]);
    // Show title shapes the label rather than placing it, so it lives in the
    // fine-tuning drawer now.
    await user.click(screen.getByRole("button", { name: /Fine tuning/ }));
    await user.click(screen.getByRole("switch", { name: "Show title" }));
    expect(callbacks.onProductStyleChange).toHaveBeenCalledWith({
      showTitle: false,
    });
    // The price tag panel is here too, on the same overrides, one group over.
    // It starts collapsed: a dozen tag settings ahead of the four that shape
    // the tile is what the grouping exists to stop.
    await user.click(screen.getByRole("button", { name: "Price tag" }));
    await user.click(screen.getByRole("button", { name: "Mono" }));
    expect(callbacks.onProductStyleChange).toHaveBeenCalledWith({
      priceTagFont: "mono",
    });
    await user.click(screen.getByRole("button", { name: "Reset to theme" }));
    expect(callbacks.onProductStyleReset).toHaveBeenCalledTimes(1);
  });

  it("all products with no overrides hides the reset affordance", () => {
    renderMulti([productBlock(0), productBlock(1)]);
    expect(
      screen.queryByRole("button", { name: "Reset to theme" }),
    ).not.toBeInTheDocument();
  });

  it("mixed types: group actions only, products excluded from duplicate", async () => {
    const user = userEvent.setup();
    const callbacks = renderMulti([
      productBlock(0),
      shapeBlock("star", 1),
      textBlock(2),
    ]);
    expect(screen.getByText(/different types/i)).toBeInTheDocument();
    const duplicate = screen.getByRole("button", { name: /duplicate 2 blocks/i });
    expect(duplicate.textContent).toMatch(/not products/i);
    await user.click(duplicate);
    expect(callbacks.onDuplicate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /remove 3 blocks/i }));
    expect(callbacks.onRemove).toHaveBeenCalledTimes(1);
  });
});
