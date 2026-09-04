import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorToolbar } from "@/components/storefront/EditorToolbar";
import { useCanvasViewport } from "@/components/storefront/useCanvasViewport";

afterEach(cleanup);

/**
 * These cover the PHONE overflow menu. The responsive split itself (which
 * groups hide below `sm`) is a Tailwind concern that jsdom cannot see — it is
 * asserted at a real 390px viewport in tests/e2e/08-storefront-mobile.spec.ts.
 * What matters here is the behaviour that broke: opening the menu, and being
 * able to get back out of it.
 */

function Harness(props: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  const viewport = useCanvasViewport({ zoom: 1, pan: { x: 0, y: 0 } });
  return (
    <EditorToolbar
      onAddProduct={vi.fn()}
      onAddText={vi.fn()}
      onAddShape={vi.fn()}
      onAddElement={vi.fn()}
      onOpenShapesPanel={vi.fn()}
      canAddBlocks
      canUndo
      canRedo
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      viewport={viewport}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onZoomReset={vi.fn()}
      onTidy={vi.fn()}
      canTidy
      settingsOpen={false}
      onToggleSettings={vi.fn()}
      pagesOpen={false}
      canOpenPage
      onTogglePages={vi.fn()}
      {...props}
    />
  );
}

const moreMenu = () => screen.queryByRole("menu", { name: "More tools" });

describe("EditorToolbar overflow menu", () => {
  it("is closed until the More button is pressed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(moreMenu()).toBeNull();
    await user.click(screen.getByRole("button", { name: "More tools" }));
    expect(moreMenu()).toBeInTheDocument();
  });

  it("holds exactly what the phone bar gave up", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    const menu = moreMenu()!;
    for (const name of ["Redo", "Tidy up", "Reset zoom"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("each item fires its action and closes the menu", async () => {
    const onTidy = vi.fn();
    const user = userEvent.setup();
    render(<Harness onTidy={onTidy} />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    await user.click(within(moreMenu()!).getByRole("menuitem", { name: "Tidy up" }));
    expect(onTidy).toHaveBeenCalledTimes(1);
    expect(moreMenu()).toBeNull();
  });

  it("disabled history actions stay disabled inside the menu", async () => {
    const user = userEvent.setup();
    render(<Harness canRedo={false} canTidy={false} />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    const menu = moreMenu()!;
    expect(within(menu).getByRole("menuitem", { name: "Redo" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Tidy up" })).toBeDisabled();
  });

  /**
   * The regression guard. The first version used a `fixed inset-0` backdrop,
   * which cannot work: the toolbar is centred with `-translate-x-1/2`, and a
   * transformed ancestor becomes the containing block for fixed descendants —
   * so the backdrop covered the toolbar, not the screen, and taps on the
   * canvas never dismissed the menu. It is a document listener now.
   */
  it("a pointerdown anywhere outside dismisses it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    expect(moreMenu()).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(moreMenu()).toBeNull();
  });

  it("survives a pointerdown that an ancestor would have swallowed", async () => {
    const user = userEvent.setup();
    const { container } = render(
      // The designer canvas stops propagation on pointerdown so a resize
      // gesture cannot also start a move; a bubble-phase listener would never
      // see this and the menu would stay stuck open.
      <div onPointerDownCapture={(event) => event.stopPropagation()}>
        <Harness />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "More tools" }));
    expect(moreMenu()).toBeInTheDocument();

    fireEvent.pointerDown(container.firstChild as Element);
    expect(moreMenu()).toBeNull();
  });

  it("Escape dismisses it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(moreMenu()).toBeNull();
  });

  it("a pointerdown inside the menu does NOT dismiss it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    fireEvent.pointerDown(
      within(moreMenu()!).getByRole("menuitem", { name: "Redo" }),
    );
    expect(moreMenu()).toBeInTheDocument();
  });
});

describe("EditorToolbar zoom-to-fit removal", () => {
  it("no fit-to-screen control exists", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /fit the canvas/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /zoom to fit/i })).toBeNull();
  });

  it("the remaining zoom controls are still there", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reset zoom to 100%/i }),
    ).toBeInTheDocument();
  });
});

/**
 * The Element tool. It replaced the Shape tool when uploading your own artwork
 * moved into the toolbar, and the library it used to hold moved OUT: the menu
 * now leads with upload, keeps six shapes inline, and sends the rest to the
 * left panel. The hover mechanics are unchanged, so what is covered here is
 * the contents and the wiring.
 */
const elementMenu = () => screen.queryByRole("menu", { name: "Elements" });

/**
 * Unlike the More menu, this one is always MOUNTED — it reveals on hover, which
 * is a CSS concern, so React cannot be the thing that unmounts it. Its open
 * state therefore lives on the trigger's aria-expanded, which is also what a
 * screen reader goes by.
 */
const elementMenuOpen = () =>
  screen.getByRole("button", { name: "Add element" }).getAttribute("aria-expanded") ===
  "true";

describe("EditorToolbar element tool", () => {
  it("is labelled Element, not Shape", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Add element" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add shape" })).toBeNull();
  });

  it("leads with uploading your own image", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Add element" }));
    expect(
      within(elementMenu()!).getByRole("menuitem", { name: "Upload" }),
    ).toBeInTheDocument();
  });

  it("says so while an upload is in flight, rather than looking inert", async () => {
    const user = userEvent.setup();
    render(<Harness uploadingElement />);
    await user.click(screen.getByRole("button", { name: "Add element" }));
    const item = within(elementMenu()!).getByRole("menuitem", { name: "Uploading…" });
    expect(item).toBeDisabled();
  });

  it("keeps the quick shapes inline and inserts the one pressed", async () => {
    const onAddShape = vi.fn();
    const user = userEvent.setup();
    render(<Harness onAddShape={onAddShape} />);
    await user.click(screen.getByRole("button", { name: "Add element" }));
    const menu = elementMenu()!;
    for (const name of ["Add square", "Add circle"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
    await user.click(within(menu).getByRole("menuitem", { name: "Add circle" }));
    expect(onAddShape).toHaveBeenCalledWith("circle");
    expect(elementMenuOpen()).toBe(false);
  });

  it("is exactly four items, so it stays one row tall", async () => {
    // The size IS the requirement here. This menu began as all 22 shapes and
    // scrolled sideways; anything that grows it back past a single row has
    // undone the point of moving the library into the panel.
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Add element" }));
    const items = within(elementMenu()!).getAllByRole("menuitem");
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.getAttribute("aria-label") ?? item.textContent)).toEqual(
      ["Upload", "All shapes", "Add square", "Add circle"],
    );
  });

  it("no longer carries the whole library — that is what the panel is for", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Add element" }));
    const menu = elementMenu()!;
    // A kind deliberately left out of QUICK_SHAPE_KINDS.
    expect(within(menu).queryByRole("menuitem", { name: "Add hexagon" })).toBeNull();
  });

  it("sends the seller to the panel for everything else", async () => {
    const onOpenShapesPanel = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenShapesPanel={onOpenShapesPanel} />);
    await user.click(screen.getByRole("button", { name: "Add element" }));
    await user.click(
      within(elementMenu()!).getByRole("menuitem", { name: "All shapes" }),
    );
    expect(onOpenShapesPanel).toHaveBeenCalledTimes(1);
    expect(elementMenuOpen()).toBe(false);
  });

  it("offers the library from the phone menu too, where hover means nothing", async () => {
    const onOpenShapesPanel = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenShapesPanel={onOpenShapesPanel} />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    await user.click(within(moreMenu()!).getByRole("menuitem", { name: "All shapes" }));
    expect(onOpenShapesPanel).toHaveBeenCalledTimes(1);
    expect(moreMenu()).toBeNull();
  });

  it("hands the picked file straight to the designer", async () => {
    const onAddElement = vi.fn();
    render(<Harness onAddElement={onAddElement} />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onAddElement).toHaveBeenCalledTimes(1);
    expect(onAddElement.mock.calls[0][0]).toBe(file);
  });

  it("clears the input, so the same file can be picked again after a failure", async () => {
    const onAddElement = vi.fn();
    render(<Harness onAddElement={onAddElement} />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(input, { target: { files: [file] } });
    // Without the reset, re-picking the SAME file fires no change event at all
    // and a retry after a failed upload would silently do nothing.
    expect(input.value).toBe("");
  });

  it("accepts SVG by extension as well as by type", () => {
    render(<Harness />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    // Browsers report SVG's MIME inconsistently, so the filter carries both.
    expect(input.accept).toContain("image/svg+xml");
    expect(input.accept).toContain(".svg");
  });

  it("disables inserting at the block cap", async () => {
    const user = userEvent.setup();
    render(<Harness canAddBlocks={false} />);
    expect(screen.getByRole("button", { name: "Add element" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "More tools" }));
    // The panel route stays open: browsing the library is not an insert.
    expect(
      within(moreMenu()!).getByRole("menuitem", { name: "All shapes" }),
    ).toBeEnabled();
  });
});
