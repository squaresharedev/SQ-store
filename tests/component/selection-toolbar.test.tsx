import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Product } from "@/types/product";
import { blockKey, type StorefrontBlock } from "@/types/storefront";
import { SelectionToolbar } from "@/components/storefront/SelectionToolbar";

/**
 * ONE ISLAND, AND IT OFFERS ONLY WHAT THE SELECTION CAN ACTUALLY DO.
 *
 * The controls used to be drawn per tile, where a product tile simply rendered
 * a Frame button and a text tile a Type button — the block's own type decided
 * it, in place. Out here one bar serves every block, so the same decisions are
 * made from the selection instead, and getting them wrong shows up as a button
 * that does nothing (Frame on a shape) or a missing route into a mode (no
 * Edit on text). Hence a test per rule.
 */

afterEach(cleanup);

const PRODUCT: Product = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Enamel mug",
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

/** A product with no photo: nothing to frame, so no Frame button. */
const PHOTOLESS: Product = { ...PRODUCT, id: "22222222-2222-4222-8222-222222222222", imageUrl: null };

const productBlock: StorefrontBlock = {
  type: "product",
  productId: PRODUCT.id,
  x: 0,
  y: 0,
  w: 2,
  h: 2,
};

const textBlock: StorefrontBlock = {
  type: "text",
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  text: "Sale ends Friday",
  variant: "body",
  align: "left",
  spans: [],
  x: 2,
  y: 0,
  w: 2,
  h: 1,
};

const shapeBlock: StorefrontBlock = {
  type: "shape",
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "square",
  color: "#171717",
  x: 0,
  y: 2,
  w: 1,
  h: 1,
};

const imageBlock: StorefrontBlock = {
  type: "image",
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  key: "elements/abc.png",
  alt: "",
  fit: "cover",
  x: 3,
  y: 2,
  w: 1,
  h: 1,
};

/** What the designer hands over for image elements: signed URLs by block key. */
const elementUrls = { [blockKey(imageBlock)]: "https://cdn.test.invalid/abc.png" };

const productsById = new Map([
  [PRODUCT.id, PRODUCT],
  [PHOTOLESS.id, PHOTOLESS],
]);

function renderToolbar(
  blocks: StorefrontBlock[],
  overrides: { openPages?: string[] } = {},
) {
  const onOpenPage = vi.fn();
  const onType = vi.fn();
  const onFrame = vi.fn();
  const onOpenColor = vi.fn();
  const onOpenSetting = vi.fn();
  const onDuplicate = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <SelectionToolbar
      blocks={blocks}
      productsById={productsById}
      elementUrls={elementUrls}
      openPages={overrides.openPages ?? []}
      onOpenPage={onOpenPage}
      onType={onType}
      onFrame={onFrame}
      onOpenColor={onOpenColor}
      onOpenSetting={onOpenSetting}
      onDuplicate={onDuplicate}
      onRemove={onRemove}
    />,
  );
  return {
    ...view,
    onOpenPage,
    onType,
    onFrame,
    onOpenColor,
    onOpenSetting,
    onDuplicate,
    onRemove,
  };
}

const button = (name: RegExp) => screen.queryByRole("button", { name });

describe("SelectionToolbar", () => {
  it("draws nothing at all when nothing is selected", () => {
    const { container } = renderToolbar([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("names nothing on the bar itself", () => {
    // It used to carry the block's name so a detached bar could say which
    // block it meant. It is not detached any more — it sits on the block — and
    // a product's title was the widest thing on it, wider than most tiles.
    renderToolbar([productBlock]);
    expect(screen.queryByText("Enamel mug")).toBeNull();
    cleanup();
    renderToolbar([textBlock]);
    expect(screen.queryByText("Sale ends Friday")).toBeNull();
  });

  // Frame's button is the dependable route into crop mode: double-tap is
  // unreliable on touch, and iOS claims it outright.
  it("offers a product its page, its crop, and removal", () => {
    renderToolbar([productBlock]);
    expect(button(/open the product page/i)).not.toBeNull();
    expect(button(/frame the image/i)).not.toBeNull();
    expect(button(/remove .* from grid/i)).not.toBeNull();
    expect(button(/edit the text/i)).toBeNull();
  });

  it("offers text its editor, and no crop", () => {
    renderToolbar([textBlock]);
    expect(button(/edit the text/i)).not.toBeNull();
    expect(button(/frame the image/i)).toBeNull();
    expect(button(/product page/i)).toBeNull();
  });

  it("gives a shape Canva's four, in Canva's order", () => {
    renderToolbar([shapeBlock]);
    const bar = screen.getByRole("toolbar");
    // The two whole-block actions (duplicate, remove) sit after a divider and
    // are not part of the four; the four are what the shape ITSELF offers.
    const offered = [...bar.querySelectorAll("button")]
      .map((el) => el.getAttribute("aria-label") ?? "")
      .filter((name) => !/remove|duplicate/i.test(name));
    expect(offered).toEqual([
      "Change the colour of Square",
      "Edit the stroke of Square",
      "Edit the corner roundness of Square",
      "Edit the opacity of Square",
    ]);
    // Not a product and not text: nothing to crop, nothing to type.
    expect(button(/frame the image/i)).toBeNull();
    expect(button(/edit the text/i)).toBeNull();
    expect(button(/product page/i)).toBeNull();
  });

  it("leaves corners off a shape whose corners are fixed by construction", () => {
    // A circle has none to round, so the control would do nothing.
    renderToolbar([{ ...shapeBlock, kind: "circle" }]);
    expect(button(/corner roundness/i)).toBeNull();
    expect(button(/edit the stroke/i)).not.toBeNull();
    expect(button(/edit the opacity/i)).not.toBeNull();
  });

  it("offers an image its crop and its opacity, and nothing a shape owns", () => {
    // An image element carries no colour and no border in its schema — the
    // artwork is the artwork — so offering either would be a dead button.
    renderToolbar([imageBlock]);
    expect(button(/frame the image/i)).not.toBeNull();
    expect(button(/edit the opacity/i)).not.toBeNull();
    expect(button(/remove .* from grid/i)).not.toBeNull();
    expect(button(/change the colour/i)).toBeNull();
    expect(button(/edit the stroke/i)).toBeNull();
    expect(button(/corner roundness/i)).toBeNull();
  });

  it("sends a colour request naming which colour it means", () => {
    const { onOpenColor } = renderToolbar([shapeBlock]);
    fireEvent.click(button(/change the colour/i)!);
    expect(onOpenColor).toHaveBeenCalledWith(blockKey(shapeBlock), "fill");
  });

  it("points at the inspector's control rather than opening one over the block", () => {
    // The bar rides ON the block, so a slider dropped under it covers the very
    // shape whose number is being dragged. It asks the panel — docked beside
    // the canvas, covering nothing — to show and mark the field instead.
    const { onOpenSetting } = renderToolbar([shapeBlock]);

    fireEvent.click(button(/edit the stroke/i)!);
    expect(onOpenSetting).toHaveBeenLastCalledWith(blockKey(shapeBlock), "stroke");

    fireEvent.click(button(/corner roundness/i)!);
    expect(onOpenSetting).toHaveBeenLastCalledWith(blockKey(shapeBlock), "corners");

    fireEvent.click(button(/edit the opacity/i)!);
    expect(onOpenSetting).toHaveBeenLastCalledWith(blockKey(shapeBlock), "opacity");

    // And nothing is drawn over the board to do it with.
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends an image's opacity to the same place", () => {
    const { onOpenSetting } = renderToolbar([imageBlock]);
    fireEvent.click(button(/edit the opacity/i)!);
    expect(onOpenSetting).toHaveBeenCalledWith(blockKey(imageBlock), "opacity");
  });

  it("draws icons only, and keeps the words for assistive tech", () => {
    // The bar has to fit over the block it points at; a product's own title
    // was wider than most tiles. Every label survives as an accessible name.
    renderToolbar([productBlock]);
    const bar = screen.getByRole("toolbar");
    // Nothing on the bar spells the block out; the only text in it is the tips,
    // which are aria-hidden and stay hidden until a button is hovered.
    expect(bar.textContent).not.toContain("Enamel mug");
    for (const el of bar.querySelectorAll("button")) {
      expect(el.getAttribute("aria-label")).toBeTruthy();
      expect(el.querySelector("[aria-hidden]")).not.toBeNull();
    }
  });

  it("spells Remove for assistive tech even though it draws only a bin", () => {
    // The bar rides over the seller's work, so the one control that needs no
    // word does without it — but the name has to survive for a screen reader.
    renderToolbar([shapeBlock]);
    const remove = button(/remove .* from grid/i)!;
    // Only the hover tip, which is aria-hidden and hidden until hovered.
    expect(remove.textContent).toBe("Delete");
    expect(remove).toHaveAttribute("aria-label", "Remove Square from grid");
  });

  it("does not offer to frame a product with no photo", () => {
    // The button used to be decided by the block's type alone; a product whose
    // photo is missing has nothing to move inside the frame.
    renderToolbar([{ ...productBlock, productId: PHOTOLESS.id }]);
    expect(button(/frame the image/i)).toBeNull();
  });

  it("reads as a toggle while the product's page is out", () => {
    renderToolbar([productBlock], { openPages: [PRODUCT.id] });
    const page = button(/close the product page/i);
    expect(page).not.toBeNull();
    expect(page).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the shared action for a multiple selection", () => {
    // Everything but Remove acts on one block, so with several selected the
    // only honest offer is the one that takes them all.
    renderToolbar([productBlock, textBlock, shapeBlock]);
    expect(button(/remove 3 elements from grid/i)).not.toBeNull();
    expect(button(/frame the image/i)).toBeNull();
    expect(button(/edit the text/i)).toBeNull();
    expect(button(/product page/i)).toBeNull();
  });

  it("removes the whole selection in one act", () => {
    // Three tiles is one removal and one entry in the history, not three.
    const { onRemove } = renderToolbar([productBlock, textBlock, shapeBlock]);
    fireEvent.click(button(/remove 3 elements from grid/i)!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls[0][0]).toHaveLength(3);
  });

  /**
   * DUPLICATE, AND WHO GETS IT. The bar is the only route to copying a block
   * without a keyboard, and it is offered exactly where copying means
   * something: a product tile is one per product by design, so a selection of
   * nothing but products has nothing to duplicate.
   */
  it("offers duplicate to the blocks that can actually be copied", () => {
    renderToolbar([shapeBlock]);
    expect(button(/^duplicate/i)).not.toBeNull();
    cleanup();

    renderToolbar([textBlock]);
    expect(button(/^duplicate/i)).not.toBeNull();
    cleanup();

    renderToolbar([imageBlock]);
    expect(button(/^duplicate/i)).not.toBeNull();
    cleanup();

    // A product cannot be copied, so the button is not drawn at all rather
    // than drawn and inert.
    renderToolbar([productBlock]);
    expect(button(/^duplicate/i)).toBeNull();
  });

  it("duplicates the copyable half of a mixed selection", () => {
    const { onDuplicate } = renderToolbar([productBlock, textBlock, shapeBlock]);
    const duplicate = button(/^duplicate 2 elements/i)!;
    expect(duplicate).not.toBeNull();
    fireEvent.click(duplicate);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    // The product is filtered out here rather than ignored downstream.
    expect(onDuplicate.mock.calls[0][0]).toEqual([
      blockKey(textBlock),
      blockKey(shapeBlock),
    ]);
  });

  it("hands each action the block it was drawn for", () => {
    const text = renderToolbar([textBlock]);
    fireEvent.click(button(/edit the text/i)!);
    expect(text.onType).toHaveBeenCalledWith(blockKey(textBlock));
    cleanup();

    const product = renderToolbar([productBlock]);
    fireEvent.click(button(/open the product page/i)!);
    // The page is opened by PRODUCT, not by block key: one page per product,
    // however many tiles point at it.
    expect(product.onOpenPage).toHaveBeenCalledWith(PRODUCT.id);
    fireEvent.click(button(/frame the image/i)!);
    expect(product.onFrame).toHaveBeenCalledTimes(1);
  });
});
