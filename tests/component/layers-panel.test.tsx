import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product } from "@/types/product";
import type {
  ImageBlock,
  ShapeBlock,
  StorefrontBlock,
  TextBlock,
} from "@/types/storefront";
import { LayersPanel } from "@/components/storefront/LayersPanel";

/**
 * The stack, as a list.
 *
 * Two things here are the whole feature and both are easy to get backwards.
 * The list is drawn FRONT FIRST while z counts from the back, so every index
 * that leaves this component is converted — a list that agreed with itself but
 * disagreed with the board would move blocks the wrong way and look right
 * doing it. And a row is a way to REACH a block, which is what makes the list
 * worth having: the block you cannot click is the one buried under something.
 */

afterEach(cleanup);

const shape = (
  id: string,
  kind: ShapeBlock["kind"],
  x: number,
  z: number,
): ShapeBlock => ({
  type: "shape",
  id,
  kind,
  color: "#ff0000",
  x,
  y: 0,
  w: 1,
  h: 1,
  z,
});

const text = (id: string, body: string, x: number, z: number): TextBlock => ({
  type: "text",
  id,
  text: body,
  variant: "body",
  align: "left",
  x,
  y: 0,
  w: 1,
  h: 1,
  z,
});

const image = (id: string, alt: string, x: number, z: number): ImageBlock => ({
  type: "image",
  id,
  key: `elements/u/${id}.png`,
  alt,
  x,
  y: 0,
  w: 1,
  h: 1,
  z,
});

/** Back to front: a circle, then the words, then the picture on top. */
const board: StorefrontBlock[] = [
  shape("s1", "circle", 0, 0),
  text("t1", "Summer sale", 1, 1),
  image("i1", "Logo", 2, 2),
];

function renderPanel(
  blocks: StorefrontBlock[] = board,
  selectedKeys: string[] = [],
) {
  const onSelect = vi.fn();
  const onReorder = vi.fn();
  const onMoveTo = vi.fn();
  const onBack = vi.fn();
  const view = render(
    <LayersPanel
      blocks={blocks}
      productsById={new Map<string, Product>()}
      elementUrls={{}}
      selectedKeys={selectedKeys}
      onSelect={onSelect}
      onReorder={onReorder}
      onMoveTo={onMoveTo}
      onBack={onBack}
    />,
  );
  return { ...view, onSelect, onReorder, onMoveTo, onBack };
}

const rows = () =>
  within(screen.getByRole("list", { name: /Canvas layers/ })).getAllByRole(
    "listitem",
  );

/** Every row's name, top to bottom. Read off the grip, whose label is exactly
 *  one name and nothing else. */
const rowNames = () =>
  rows().map(
    (row) =>
      within(row)
        .getAllByRole("button")[0]
        .getAttribute("aria-label")
        ?.replace("Reorder ", "") ?? "",
  );

function rowFor(name: string): HTMLElement {
  const found = rows().find((row) =>
    within(row).queryByRole("button", { name: `Reorder ${name}` }),
  );
  if (!found) throw new Error(`no row named ${name}`);
  return found;
}

/** The row's own body, which is the control that selects the block. */
const pickButton = (name: string) =>
  within(rowFor(name)).getAllByRole("button")[1];

describe("LayersPanel", () => {
  it("draws the front of the stack at the top", () => {
    // The opposite of z, and the same way round as every layers list a seller
    // has used before this one.
    renderPanel();
    expect(rowNames()).toEqual(["Logo", "Summer sale", "Circle"]);
  });

  it("names a block by what it says, falling back to its kind", () => {
    renderPanel([shape("s1", "star", 0, 0), text("t1", "   ", 1, 1)]);
    // An empty text block is still recognisably text; a row saying nothing
    // would be less use than one saying "Text".
    expect(rowNames()).toEqual(["Text", "Star"]);
  });

  it("hands back the block a row names", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPanel();
    await user.click(pickButton("Summer sale"));
    // A plain press SELECTS rather than toggling: on the canvas a click can
    // also mean "nothing here", but in a list a row is only ever its block.
    expect(onSelect).toHaveBeenCalledWith("t_t1", false);
  });

  it("extends the selection when the press carries a modifier", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPanel();
    await user.keyboard("{Shift>}");
    await user.click(pickButton("Logo"));
    await user.keyboard("{/Shift}");
    expect(onSelect).toHaveBeenCalledWith("i_i1", true);
  });

  it("marks the rows the canvas has selected", () => {
    renderPanel(board, ["t_t1"]);
    expect(pickButton("Summer sale")).toHaveAttribute("aria-pressed", "true");
    expect(pickButton("Logo")).toHaveAttribute("aria-pressed", "false");
  });

  it("reorders from the grip with the arrow keys", async () => {
    const user = userEvent.setup();
    const { onReorder } = renderPanel();
    screen.getByRole("button", { name: "Reorder Summer sale" }).focus();
    // Up is toward the front, because up is where the front is drawn.
    await user.keyboard("{ArrowUp}");
    expect(onReorder).toHaveBeenCalledWith("t_t1", "forward");
    await user.keyboard("{ArrowDown}");
    expect(onReorder).toHaveBeenCalledWith("t_t1", "backward");
    // Shift sends it the whole way — the same modifier the Ctrl+bracket
    // shortcuts already spend on exactly that.
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(onReorder).toHaveBeenCalledWith("t_t1", "front");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(onReorder).toHaveBeenCalledWith("t_t1", "back");
  });

  it("expands one row at a time, and only on request", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.queryByRole("group", { name: /^Move / })).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Show layer options for Logo" }),
    );
    expect(screen.getByRole("group", { name: "Move Logo" })).toBeTruthy();

    // Two open rows in a 320px column push the rest off screen.
    await user.click(
      screen.getByRole("button", { name: "Show layer options for Circle" }),
    );
    expect(screen.queryByRole("group", { name: "Move Logo" })).toBeNull();
    expect(screen.getByRole("group", { name: "Move Circle" })).toBeTruthy();
  });

  it("counts an expanded row's depth from the BACK, like the placement panel", async () => {
    const user = userEvent.setup();
    renderPanel();
    // Top row of three is the front, which is layer 3 — the two readouts must
    // never disagree about which layer a block is on.
    await user.click(
      screen.getByRole("button", { name: "Show layer options for Logo" }),
    );
    expect(screen.getByText("Layer 3 of 3")).toBeTruthy();
  });

  it("disables the moves a row at the end of the stack cannot make", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      screen.getByRole("button", { name: "Show layer options for Logo" }),
    );
    expect(
      screen.getByRole("button", { name: "Bring to front: Logo" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Send to back: Logo" }),
    ).not.toBeDisabled();
  });

  it("routes an expanded row's move to THAT block, not to the selection", async () => {
    const user = userEvent.setup();
    const { onReorder } = renderPanel(board, ["i_i1"]);
    await user.click(
      screen.getByRole("button", { name: "Show layer options for Circle" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Bring to front: Circle" }),
    );
    expect(onReorder).toHaveBeenCalledWith("s_s1", "front");
  });

  it("says so when there is nothing on the canvas", () => {
    renderPanel([]);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/Nothing on the canvas yet/)).toBeTruthy();
  });

  it("offers the way back out", async () => {
    const user = userEvent.setup();
    const { onBack } = renderPanel();
    await user.click(screen.getByRole("button", { name: /leaving Layers/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
