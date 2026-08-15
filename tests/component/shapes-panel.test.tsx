import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SHAPE_KINDS } from "@/types/storefront";
import { SHAPE_SPECS } from "@/components/storefront/shape-specs";
import { ShapesPanel } from "@/components/storefront/ShapesPanel";

/**
 * The shape half of the left-hand library. Its whole reason for existing is
 * that all 22 kinds are reachable here — that is what the toolbar's two-shape
 * menu gave up — so the coverage assertion is the point of this file.
 *
 * The header and close button belong to LibraryPanel, which wraps this.
 */

afterEach(cleanup);

function renderPanel(canAddBlocks = true) {
  const onAddShape = vi.fn();
  render(<ShapesPanel onAddShape={onAddShape} canAddBlocks={canAddBlocks} />);
  return { onAddShape };
}

/** The panel labels each button "Add {label}", lowercased. */
const buttonName = (kind: (typeof SHAPE_KINDS)[number]) =>
  `Add ${SHAPE_SPECS[kind].label.toLowerCase()}`;

describe("ShapesPanel", () => {
  it("renders a button for EVERY shape kind", () => {
    renderPanel();
    for (const kind of SHAPE_KINDS) {
      expect(
        screen.getByRole("button", { name: buttonName(kind) }),
        kind,
      ).toBeInTheDocument();
    }
  });

  it("inserts the shape that was pressed", async () => {
    const user = userEvent.setup();
    const { onAddShape } = renderPanel();
    await user.click(screen.getByRole("button", { name: buttonName("hexagon") }));
    expect(onAddShape).toHaveBeenCalledWith("hexagon");
  });

  it("keeps taking picks, so several shapes are several clicks", async () => {
    const user = userEvent.setup();
    const { onAddShape } = renderPanel();
    await user.click(screen.getByRole("button", { name: buttonName("circle") }));
    await user.click(screen.getByRole("button", { name: buttonName("star") }));
    expect(onAddShape).toHaveBeenNthCalledWith(1, "circle");
    expect(onAddShape).toHaveBeenNthCalledWith(2, "star");
  });

  it("disables every shape at the block cap", () => {
    renderPanel(false);
    for (const kind of SHAPE_KINDS) {
      expect(screen.getByRole("button", { name: buttonName(kind) }), kind).toBeDisabled();
    }
  });

  it("groups the library rather than listing it flat", () => {
    renderPanel();
    for (const title of ["Basic", "Polygons", "Accents"]) {
      expect(screen.getByRole("group", { name: `${title} shapes` })).toBeInTheDocument();
    }
  });
});
