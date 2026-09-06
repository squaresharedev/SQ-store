import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "../setup/render";
import { BlockTile } from "@/components/storefront/BlockTile";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductBlock, StorefrontBlock } from "@/types/storefront";
import type { Product } from "@/types/product";

/**
 * The tile half of framing: entering the mode, and the guarantee that while
 * it is on, the gestures the grid normally owns belong to the picture instead.
 *
 * The placement arithmetic is pinned in tests/unit/image-placement.test.ts;
 * what is checked here is the wiring that a maths test cannot see.
 */

const theme = DEFAULT_STOREFRONT_CONFIG.theme;

const product: Product = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Framed Print",
  description: "",
  price: 24,
  currency: "EUR",
  status: "active",
  imageUrl: "https://images.test.invalid/print.jpg",
  digitalFileKey: null,
  createdAt: new Date("2026-01-01").toISOString(),
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 0,
} as unknown as Product;

const block: ProductBlock = {
  type: "product",
  productId: product.id,
  x: 0,
  y: 0,
  w: 2,
  h: 2,
};

function renderTile(
  overrides: {
    block?: StorefrontBlock;
    product?: Product | null;
    isFraming?: boolean;
  } = {},
) {
  const onFrame = vi.fn();
  const onFramePlacement = vi.fn();
  const onFrameExit = vi.fn();
  const onToggleEdit = vi.fn();
  render(
    <BlockTile
      blockKey="block-1"
      block={overrides.block ?? block}
      product={overrides.product === undefined ? product : overrides.product}
      theme={theme}
      editable
      isFraming={overrides.isFraming ?? false}
      onToggleEdit={onToggleEdit}
      onRemove={vi.fn()}
      onFrame={onFrame}
      onFramePlacement={onFramePlacement}
      onFrameExit={onFrameExit}
    />,
  );
  return { onFrame, onFramePlacement, onFrameExit, onToggleEdit };
}

const framer = () => screen.queryByTestId("tile-image-framer");
// PLT-02: the outer container is a plain focusable div (no role="button"), so
// getByRole("button") no longer finds it. getByLabelText reaches it via
// aria-label. The pattern anchors to "Framed Print" at the start to skip the
// chip's "Frame the image for Framed Print" button, whose label also
// contains the product name.
const tile = () => screen.getByLabelText(/^Framed Print/);

// Vitest runs without globals here, so RTL's auto-cleanup never registers —
// the repo's component specs unmount explicitly (see storefront-tile-style).
afterEach(cleanup);

beforeAll(() => {
  // jsdom has no layout engine, so setPointerCapture is missing entirely.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

describe("entering frame mode", () => {
  it("opens on a double-click", () => {
    const { onFrame } = renderTile();
    fireEvent.dblClick(tile());
    expect(onFrame).toHaveBeenCalledWith("block-1");
  });

  it("does not toggle the selection off under the double-click", () => {
    // A double-click fires two clicks first. Letting the second through would
    // deselect the very tile that is about to be framed, which showed up as
    // the inspector flickering shut.
    const { onToggleEdit } = renderTile();
    fireEvent.click(tile(), { detail: 1 });
    fireEvent.click(tile(), { detail: 2 });
    expect(onToggleEdit).toHaveBeenCalledTimes(1);
  });

  it("has a keyboard route in", () => {
    const { onFrame } = renderTile();
    fireEvent.keyDown(tile(), { key: "f" });
    expect(onFrame).toHaveBeenCalledWith("block-1");
  });

  it("offers a button, because double-tap is not dependable on touch", () => {
    renderTile();
    expect(
      screen.getByRole("button", { name: /frame the image for framed print/i }),
    ).toBeInTheDocument();
  });

  it("stays shut for a product with no picture to frame", () => {
    const { onFrame } = renderTile({
      product: { ...product, imageUrl: null } as Product,
    });
    fireEvent.dblClick(tile());
    expect(onFrame).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /frame the image/i }),
    ).not.toBeInTheDocument();
  });

  it("stays shut for a block whose product was deleted", () => {
    // PLT-02: same selector strategy as `tile()` above — the container is a
    // plain focusable div whose aria-label starts with the product label.
    const { onFrame } = renderTile({ product: null });
    fireEvent.dblClick(screen.getByLabelText(/^Removed product/));
    expect(onFrame).not.toHaveBeenCalled();
  });
});

describe("while framing", () => {
  it("marks the box the picture is really cropped to", () => {
    // The tile is NOT that box: a `bar` title takes a row of the tile's own
    // column, so the picture's frame is shorter. Both the framing surface and
    // the dimmed copy of the rest of the picture measure this marker; without
    // it they fall back to the tile, and the overflow is drawn several percent
    // too big. jsdom cannot see the sizes, but it can see the marker go
    // missing, which is the only way this gets broken.
    renderTile({ isFraming: true });
    const frame = document.querySelector("[data-image-frame]");
    expect(frame).not.toBeNull();
    expect(frame!.querySelector("img")).not.toBeNull();
    // And it is the picture's own box, not the whole face: the title band is
    // a sibling of it, never inside it.
    expect(frame!.querySelector("[data-title-band]")).toBeNull();
  });

  it("puts a framing surface over the tile, and names what it frames", () => {
    renderTile({ isFraming: true });
    const surface = framer()!;
    expect(surface).toBeInTheDocument();
    expect(surface).toHaveAttribute("role", "application");
    expect(surface.getAttribute("aria-label")).toMatch(/framed print/i);
  });

  it("takes the tile's controls away", () => {
    // A Remove button under a dragging finger is a trap.
    renderTile({ isFraming: true });
    expect(
      screen.queryByRole("button", { name: /remove .* from grid/i }),
    ).not.toBeInTheDocument();
  });

  it("nudges the picture with the arrow keys", () => {
    const { onFramePlacement } = renderTile({ isFraming: true });
    fireEvent.keyDown(framer()!, { key: "ArrowRight" });
    expect(onFramePlacement).toHaveBeenCalledTimes(1);
    const [, placement] = onFramePlacement.mock.calls[0];
    // Right reveals the picture's right side, which is a larger x.
    expect((placement as { x: number }).x).toBeGreaterThan(50);
  });

  it("zooms with plus and minus", () => {
    const { onFramePlacement } = renderTile({ isFraming: true });
    fireEvent.keyDown(framer()!, { key: "+" });
    const [, zoomedIn] = onFramePlacement.mock.calls[0];
    expect((zoomedIn as { scale: number }).scale).toBeGreaterThan(100);
  });

  it("will not zoom out past covering the frame", () => {
    // Below 100 the picture could not fill its tile, which no frame allows.
    const { onFramePlacement } = renderTile({ isFraming: true });
    fireEvent.keyDown(framer()!, { key: "-" });
    expect(onFramePlacement).not.toHaveBeenCalled();
  });

  it("keeps arrow keys away from the grid underneath", () => {
    // The grid moves and resizes the BLOCK on these same keys. If the event
    // reaches it, framing a picture would drag the tile across the canvas.
    const { onFramePlacement } = renderTile({ isFraming: true });
    const event = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
    });
    const stopped = vi.spyOn(event, "stopPropagation");
    framer()!.dispatchEvent(event);
    expect(stopped).toHaveBeenCalled();
    expect(onFramePlacement).toHaveBeenCalled();
  });

  it("keeps a pointerdown away from the grid's drag", () => {
    // Same story for the pointer: the grid starts a block drag on pointerdown,
    // so a drag meant for the picture would move the tile instead.
    renderTile({ isFraming: true });
    const event = new PointerEvent("pointerdown", {
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    });
    const stopped = vi.spyOn(event, "stopPropagation");
    framer()!.dispatchEvent(event);
    expect(stopped).toHaveBeenCalled();
  });

  it("brings whatever was tapped into the middle of the frame", () => {
    // The fastest way to say "that bit, there" — and with the rest of the
    // picture visible around the tile, the obvious thing to try. On a phone
    // it beats dragging a small tile accurately.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 200, x: 0, y: 0, left: 0, top: 0 } as DOMRect);

    const { onFramePlacement } = renderTile({ isFraming: true });
    const surface = framer()!;
    // Press and release in the same spot, left of centre.
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 50, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 50, clientY: 100 });

    expect(onFramePlacement).toHaveBeenCalled();
    const [, placement] = onFramePlacement.mock.calls.at(-1)!;
    // Tapping left of centre pulls that part of the picture inward, which
    // reveals more of its left: a smaller x.
    expect((placement as { x: number }).x).toBeLessThan(50);
    box.mockRestore();
  });

  it("does not re-centre after a drag", () => {
    // Only a press that went nowhere is a tap. Without this, every drag would
    // end by yanking the picture to wherever the finger happened to stop.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 200, x: 0, y: 0, left: 0, top: 0 } as DOMRect);

    const { onFramePlacement } = renderTile({ isFraming: true });
    const surface = framer()!;
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 40, clientY: 100 });
    const afterDrag = onFramePlacement.mock.calls.length;
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 40, clientY: 100 });
    expect(onFramePlacement.mock.calls.length).toBe(afterDrag);
    box.mockRestore();
  });

  it("pans under a finger, exactly as under a mouse", () => {
    // The pointer handlers are deliberately pointerType-agnostic, so touch
    // needs no separate path — this proves that rather than assuming it.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 200, x: 0, y: 0, left: 0, top: 0 } as DOMRect);

    const { onFramePlacement } = renderTile({ isFraming: true });
    const surface = framer()!;
    const touch = { pointerType: "touch", isPrimary: true };
    fireEvent.pointerDown(surface, { pointerId: 3, clientX: 100, clientY: 100, ...touch });
    fireEvent.pointerMove(surface, { pointerId: 3, clientX: 60, clientY: 100, ...touch });

    const [, placement] = onFramePlacement.mock.calls.at(-1)!;
    // Dragging left reveals more of the picture's right: a larger x.
    expect((placement as { x: number }).x).toBeGreaterThan(50);
    box.mockRestore();
  });

  it("pinches to zoom, and the second finger cancels the pan", () => {
    // Two fingers on the picture must zoom the PICTURE. The canvas has its own
    // pinch-to-zoom on the workspace; the surface stops the event so the board
    // does not zoom underneath instead.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 200, x: 0, y: 0, left: 0, top: 0 } as DOMRect);

    const { onFramePlacement } = renderTile({ isFraming: true });
    const surface = framer()!;
    const touch = { pointerType: "touch" };
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 90, clientY: 100, ...touch });
    fireEvent.pointerDown(surface, { pointerId: 2, clientX: 110, clientY: 100, ...touch });
    // Fingers spread from 20px apart to 60px: a 3x zoom.
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 70, clientY: 100, ...touch });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 130, clientY: 100, ...touch });

    const [, placement] = onFramePlacement.mock.calls.at(-1)!;
    expect((placement as { scale: number }).scale).toBeGreaterThan(100);

    // Lifting both fingers must not then re-centre: a pinch is not a tap.
    const afterPinch = onFramePlacement.mock.calls.length;
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 70, clientY: 100, ...touch });
    fireEvent.pointerUp(surface, { pointerId: 2, clientX: 130, clientY: 100, ...touch });
    expect(onFramePlacement.mock.calls.length).toBe(afterPinch);
    box.mockRestore();
  });

  it("offers corner handles, because a picture that fits has nothing to drag", () => {
    // The gap this closes: at scale 100 the picture exactly covers the tile,
    // so there is no overhang to pan and the surface reads as inert. Every
    // route to a bigger picture (wheel, pinch, +/-) was something you had to
    // already know about.
    renderTile({ isFraming: true });
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      expect(screen.getByTestId(`tile-zoom-handle-${corner}`)).toBeInTheDocument();
    }
  });

  it("zooms one step on a tap of a corner", () => {
    // The whole gesture on a phone: no wheel, no keyboard, and pinching a tile
    // the size of a thumbnail is awkward.
    const { onFramePlacement } = renderTile({ isFraming: true });
    const handle = screen.getByTestId("tile-zoom-handle-bottom-right");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 190, clientY: 190 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 190, clientY: 190 });

    const [, placement] = onFramePlacement.mock.calls.at(-1)!;
    expect((placement as { scale: number }).scale).toBeGreaterThan(100);
  });

  it("grows the picture as a corner is pulled away from the middle", () => {
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 200, x: 0, y: 0, left: 0, top: 0 } as DOMRect);

    const { onFramePlacement } = renderTile({ isFraming: true });
    const handle = screen.getByTestId("tile-zoom-handle-bottom-right");
    // The corner starts 100√2 from the centre and is pulled to 200√2: twice
    // the reach, so twice the scale.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 300 });

    const [, placement] = onFramePlacement.mock.calls.at(-1)!;
    expect((placement as { scale: number }).scale).toBe(200);

    // ...and pushing it back in shrinks it again, down to the cover floor.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 150 });
    const [, shrunk] = onFramePlacement.mock.calls.at(-1)!;
    expect((shrunk as { scale: number }).scale).toBe(100);
    box.mockRestore();
  });

  it("does not also pan the picture while a corner is being pulled", () => {
    // The surface underneath pans on the very same events. Without the
    // handle owning them outright, zooming would drag the picture sideways.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 200, x: 0, y: 0, left: 0, top: 0 } as DOMRect);

    const { onFramePlacement } = renderTile({ isFraming: true });
    const handle = screen.getByTestId("tile-zoom-handle-top-left");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -60, clientY: -60 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: -60, clientY: -60 });

    for (const [, placement] of onFramePlacement.mock.calls) {
      const at = placement as { x: number; y: number };
      expect([at.x, at.y]).toEqual([50, 50]);
    }
    box.mockRestore();
  });

  it("leaves on Escape", () => {
    const { onFrameExit } = renderTile({ isFraming: true });
    fireEvent.keyDown(framer()!, { key: "Escape" });
    expect(onFrameExit).toHaveBeenCalled();
  });

  it("resets to centred on 0", () => {
    const framed: ProductBlock = {
      ...block,
      imagePlacement: { x: 10, y: 90, scale: 250 },
    };
    const { onFramePlacement } = renderTile({ block: framed, isFraming: true });
    fireEvent.keyDown(framer()!, { key: "0" });
    expect(onFramePlacement).toHaveBeenCalledWith("block-1", {
      x: 50,
      y: 50,
      scale: 100,
    });
  });
});

describe("the rest of the picture, while framing", () => {
  it("is not drawn when the tile is not being framed", () => {
    renderTile();
    expect(screen.queryByTestId("tile-image-ghost")).not.toBeInTheDocument();
  });

  it("draws the whole picture, dimmed, around the frame", () => {
    // Cropping blind is what makes a crop tool frustrating: you can see what
    // you kept but not what you are cutting off.
    renderTile({ isFraming: true });
    const ghost = screen.getByTestId("tile-image-ghost");
    expect(ghost).toBeInTheDocument();
    // It must not clip, or there would be no spill to see.
    expect(ghost.className).not.toMatch(/overflow-hidden/);
    expect(ghost).toHaveAttribute("aria-hidden", "true");
  });

  it("paints beneath the tile's face, so the framed part stays untouched", () => {
    // The whole design rests on DOM order rather than a mask: the dimmed copy
    // comes first, the real face paints over it, and the two can never drift
    // out of register because there is only one bright copy.
    renderTile({ isFraming: true });
    const ghost = screen.getByTestId("tile-image-ghost");
    const face = document.querySelector(".\\[contain\\:paint\\]");
    expect(face).toBeTruthy();
    expect(
      ghost.compareDocumentPosition(face!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lands the dimmed copy exactly where the frame crops it", () => {
    // jsdom measures everything as zero, so the frame and the picture are
    // given real sizes here: a 200x200 frame cropping a 400x200 photo. Cover
    // renders that at 400x200, centred, so the copy must start 100px to the
    // LEFT of the frame and run twice its width — which is precisely the
    // overhang the frame is hiding. (Every box reports 200x200 at the origin
    // under this mock, so the frame and the tile coincide; that they do NOT
    // coincide in a real layout is what the browser spec covers.)
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 200, x: 0, y: 0 } as DOMRect);
    const natural = [
      vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(400),
      vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(200),
    ];

    renderTile({ isFraming: true });
    const ghost = screen.getByTestId("tile-image-ghost");
    const copy = ghost.querySelector("img")!;
    expect(copy.style.left).toBe("-100px");
    expect(copy.style.top).toBe("0px");
    expect(copy.style.width).toBe("400px");
    expect(copy.style.height).toBe("200px");

    // Fading alone moves the picture towards whatever is behind it, and this
    // board is usually pale — which reads as washed out, not as "outside the
    // frame". A scrim darkens on any storefront background, and covers
    // exactly the same rect as the copy it is dimming.
    const scrim = ghost.querySelector<HTMLElement>("div.bg-black\\/45")!;
    expect(scrim).toBeTruthy();
    expect(scrim.style.left).toBe(copy.style.left);
    expect(scrim.style.width).toBe(copy.style.width);

    box.mockRestore();
    for (const spy of natural) spy.mockRestore();
  });
});

describe("rendering a framed tile", () => {
  it("leaves an unframed picture with no inline style at all", () => {
    renderTile();
    const image = document.querySelector("img")!;
    expect(image.style.objectPosition).toBe("");
    expect(image.style.transform).toBe("");
  });

  it("positions and pins the zoom origin to the same point", () => {
    const framed: ProductBlock = {
      ...block,
      imagePlacement: { x: 20, y: 80, scale: 200 },
    };
    renderTile({ block: framed });
    const image = document.querySelector("img")!;
    expect(image.style.objectPosition).toBe("20% 80%");
    expect(image.style.transformOrigin).toBe("20% 80%");
    expect(image.style.transform).toBe("scale(2)");
  });
});
