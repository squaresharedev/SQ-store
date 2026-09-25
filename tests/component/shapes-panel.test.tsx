import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { SHAPE_KINDS } from "@/types/storefront";
import { english } from "../setup/translate";
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

/** The panel labels each button "Add {shape}". */
const buttonName = (kind: (typeof SHAPE_KINDS)[number]) =>
  english(`Storefront.shapes.add.${kind}`);

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
    // The group's aria-label is its own catalogue key (groupLabel.*), not the
    // tab title with "shapes" appended: the two happen to share a root word,
    // but they are independent strings and a translation can diverge.
    for (const name of ["Basic shapes", "Polygon shapes", "Accent shapes"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
  });
});
