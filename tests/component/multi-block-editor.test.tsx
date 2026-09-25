import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ImageBlock,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontBlock,
  type TextBlock,
} from "@/types/storefront";
import { MultiBlockEditor } from "@/components/storefront/MultiBlockEditor";
import type { BlockFieldSummons } from "@/components/storefront/SummonedField";

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

function imageBlock(x: number): ImageBlock {
  return {
    type: "image",
    id: uid(),
    key: `elements/${x}.png`,
    alt: "",
    fit: "cover",
    x,
    y: 3,
    w: 1,
    h: 1,
  };
}

function renderMulti(blocks: StorefrontBlock[]) {
  const callbacks = {
    onProductStyleChange: vi.fn(),
    onProductStyleReset: vi.fn(),
    onShapeChange: vi.fn(),
    onTextChange: vi.fn(),
    onImageChange: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
  };
  const view = render(
    <MultiBlockEditor
      blocks={blocks}
      theme={DEFAULT_STOREFRONT_CONFIG.theme}
      {...callbacks}
    />,
  );
  return {
    ...callbacks,
    /** Press a toolbar button, in effect: the panel is already open on the
     *  selection when the summons arrives, which is the only way it ever
     *  arrives (the nonce IS the event — see useSummonFlash). */
    summon(summons: BlockFieldSummons) {
      view.rerender(
        <MultiBlockEditor
          blocks={blocks}
          theme={DEFAULT_STOREFRONT_CONFIG.theme}
          summons={summons}
          {...callbacks}
        />,
      );
    },
  };
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
    // The caveat moved off the button when Duplicate and Remove became one
    // row: half a row is not the place for a parenthetical.
    expect(screen.getByText(/products are not duplicated/i)).toBeInTheDocument();
    await user.click(duplicate);
    expect(callbacks.onDuplicate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /remove 3 blocks/i }));
    expect(callbacks.onRemove).toHaveBeenCalledTimes(1);
  });

  it("all elements: the group settings, without the two that belong to one picture", async () => {
    const user = userEvent.setup();
    const callbacks = renderMulti([imageBlock(0), imageBlock(1)]);
    // Fit and opacity are group settings and land on the whole selection.
    await user.click(screen.getByRole("button", { name: "Fit" }));
    expect(callbacks.onImageChange).toHaveBeenCalledWith({ fit: "contain" });
    // Framing positions THIS artwork inside THIS block, and a description
    // describes one picture — writing either across six would be wrong for
    // five of them.
    expect(
      screen.queryByRole("button", { name: /reposition image/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove 2 blocks/i }),
    ).toBeInTheDocument();
  });

  /**
   * THE BAR POINTS AT A CONTROL, IT DOES NOT DUPLICATE ONE. The selection
   * toolbar rides over the block, so a slider dropped under it would cover the
   * very shape whose number is being dragged — it asks the panel to show and
   * mark the field instead. With several blocks selected the panel showing it
   * is THIS one, so the summons has to reach the editors inside it. Without
   * the pass-through, every group press scrolled to nothing.
   */
  it("takes the toolbar's summons through to the editor it opens", () => {
    const lit = (field: string) =>
      document.querySelector(
        `[data-block-field='${field}'] [role='slider'][data-highlighted]`,
      );
    const group = renderMulti([shapeBlock("square", 0), shapeBlock("square", 1)]);
    expect(lit("corners")).toBeNull();

    group.summon({ field: "corners", nonce: 1 });
    expect(lit("corners")).not.toBeNull();
    // And only the one asked for.
    expect(lit("opacity")).toBeNull();

    group.summon({ field: "opacity", nonce: 2 });
    expect(lit("opacity")).not.toBeNull();
  });

  it("takes it through for a selection of elements too", () => {
    const group = renderMulti([imageBlock(0), imageBlock(1)]);
    group.summon({ field: "opacity", nonce: 1 });
    expect(
      document.querySelector(
        "[data-block-field='opacity'] [role='slider'][data-highlighted]",
      ),
    ).not.toBeNull();
  });
});
