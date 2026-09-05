import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShapeBlock, StorefrontBlock } from "@/types/storefront";
import { PlacementSection } from "@/components/storefront/PlacementSection";

/**
 * The Selection tab's placement group. What this pins is the contract between
 * the control and the designer's mutator: the slider reports an angle, the
 * quick buttons report an angle, and NEITHER of them decides whether that
 * angle is stored (withRotation owns dropping the field). A mixed selection
 * must say so rather than showing one block's angle as the group's, since the
 * next drag would flatten the others onto it.
 */

afterEach(cleanup);

const shape = (rotation?: number): ShapeBlock => ({
  type: "shape",
  id: "11111111-1111-4111-8111-111111111111",
  kind: "square",
  color: "#000000",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  ...(rotation !== undefined ? { rotation } : {}),
});

/** A distinct shape per column, so a board reads as its x coordinates. */
function shapeAt(x: number, z?: number): ShapeBlock {
  return {
    ...shape(),
    id: `0000000${x}-1111-4111-8111-111111111111`,
    x,
    ...(z !== undefined ? { z } : {}),
  };
}

function renderSection(blocks: StorefrontBlock[], board = blocks) {
  const onRotate = vi.fn();
  const onReorder = vi.fn();
  const view = render(
    <PlacementSection
      blocks={blocks}
      board={board}
      onRotate={onRotate}
      onReorder={onReorder}
    />,
  );
  return { ...view, onRotate, onReorder };
}

describe("PlacementSection rotation", () => {
  it("shows an untilted block as level, with the slider at zero", () => {
    // The degree value and the ° unit are in separate elements — the number
    // is in an editable input, the unit in a sibling <span>. Check them
    // individually rather than as one combined text node.
    renderSection([shape()]);
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Block rotation" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(slider.getAttribute("aria-valuetext")).toBe("0 degrees");
  });

  it("reflects an existing angle", () => {
    renderSection([shape(45)]);
    expect(screen.getByDisplayValue("45")).toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "Block rotation" }).getAttribute("aria-valuenow"),
    ).toBe("45");
  });

  it("says Mixed rather than picking one block's angle for the group", () => {
    renderSection([shape(45), { ...shape(10), id: "b" } as ShapeBlock]);
    expect(screen.getByText("Mixed")).toBeTruthy();
    expect(
      screen.getByRole("slider", { name: "Block rotation" }).getAttribute("aria-valuetext"),
    ).toBe("Mixed angles");
  });

  it("treats an absent rotation and an explicit zero as the same angle", () => {
    renderSection([shape(), shape(0)]);
    expect(screen.queryByText("Mixed")).toBeNull();
    // Same split-element rule as the tests above: the number is in the input,
    // the ° unit in a separate <span>.
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();
  });

  it("reports the quick angles", async () => {
    const user = userEvent.setup();
    const { onRotate } = renderSection([shape(30)]);
    await user.click(screen.getByRole("button", { name: "Rotate to 90 degrees" }));
    expect(onRotate).toHaveBeenCalledWith(90);
    await user.click(screen.getByRole("button", { name: "Rotate to -90 degrees" }));
    expect(onRotate).toHaveBeenCalledWith(-90);
  });

  it("levels a block by reporting zero, not by clearing anything itself", () => {
    // The control has no idea the field gets dropped: that is withRotation's
    // job, and keeping it there is what stops a second writer storing a zero.
    const { onRotate } = renderSection([shape(30)]);
    screen.getByRole("button", { name: "Level the block" }).click();
    expect(onRotate).toHaveBeenCalledWith(0);
  });

  it("warns that a group turns block by block, only when there IS a group", async () => {
    // The guidance moved from a standing paragraph into the "?" beside the
    // label, but it is still CONDITIONAL: what the tip says depends on the
    // selection, exactly as the paragraph's presence used to.
    const user = userEvent.setup();
    const { unmount } = renderSection([shape(), shape(0)]);
    await user.click(screen.getByRole("button", { name: "About Rotation" }));
    expect(screen.getByRole("tooltip").textContent).toContain(
      "Each block turns about its own centre",
    );
    unmount();

    renderSection([shape()]);
    await user.click(screen.getByRole("button", { name: "About Rotation" }));
    expect(screen.getByRole("tooltip").textContent).not.toContain(
      "Each block turns about its own centre",
    );
  });
});

/**
 * The layer group. Depth is a fact about the whole BOARD, not about the
 * selection, so everything here is read off the board the section is handed:
 * where the selection sits in the stack, and which way it can still travel.
 */
describe("PlacementSection layering", () => {
  const board = [shapeAt(0), shapeAt(1), shapeAt(2)];
  const button = (name: string) => screen.getByRole("button", { name });

  it("reports where a single block sits in the stack", () => {
    renderSection([board[1]], board);
    expect(screen.getByText("Layer 2 of 3")).toBeTruthy();
  });

  it("follows the stored depth rather than the reading order", () => {
    // A layered board answers from z; the same three blocks reversed say so.
    const layered = [shapeAt(0, 2), shapeAt(1, 1), shapeAt(2, 0)];
    renderSection([layered[0]], layered);
    expect(screen.getByText("Layer 3 of 3")).toBeTruthy();
  });

  it("counts a multi-selection instead of naming one block's layer", () => {
    renderSection([board[0], board[2]], board);
    expect(screen.getByText("2 blocks selected")).toBeTruthy();
    expect(screen.queryByText(/Layer \d/)).toBeNull();
  });

  it("reports each move with its own op", async () => {
    const user = userEvent.setup();
    const { onReorder } = renderSection([board[1]], board);
    for (const [name, op] of [
      ["Send to back", "back"],
      ["Send backward", "backward"],
      ["Bring forward", "forward"],
      ["Bring to front", "front"],
    ] as const) {
      await user.click(button(name));
      expect(onReorder).toHaveBeenCalledWith(op);
    }
  });

  it("disables both front controls for a block already at the front", () => {
    renderSection([board[2]], board);
    expect(button("Bring forward")).toBeDisabled();
    expect(button("Bring to front")).toBeDisabled();
    expect(button("Send backward")).not.toBeDisabled();
    expect(button("Send to back")).not.toBeDisabled();
  });

  it("disables both back controls for a run already at the back", () => {
    // "Already at the back" is about the RUN, not about one block: two blocks
    // holding the bottom two spots have nowhere left to go either.
    renderSection([board[0], board[1]], board);
    expect(button("Send backward")).toBeDisabled();
    expect(button("Send to back")).toBeDisabled();
    expect(button("Bring forward")).not.toBeDisabled();
  });

  it("points at Alt-click only once something is actually stacked", async () => {
    const user = userEvent.setup();
    const hint = "Alt-click a stack on the canvas to reach the block underneath";
    // Three blocks side by side: depth exists, but nothing is hidden by it.
    renderSection([board[0]], board);
    await user.click(screen.getByRole("button", { name: "How layering works" }));
    expect(screen.getByRole("tooltip").textContent).not.toContain(hint);
    cleanup();

    // Now one lies on another, and reaching the lower one needs the shortcut.
    const stack = [shapeAt(0), { ...shapeAt(0), id: "second" } as ShapeBlock];
    renderSection([stack[1]], stack);
    await user.click(screen.getByRole("button", { name: "How layering works" }));
    expect(screen.getByRole("tooltip").textContent).toContain(hint);
  });

  it("disables everything when the whole board is selected", () => {
    renderSection(board, board);
    for (const name of [
      "Send to back",
      "Send backward",
      "Bring forward",
      "Bring to front",
    ]) {
      expect(button(name)).toBeDisabled();
    }
  });
});
