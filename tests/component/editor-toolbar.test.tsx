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
      previewMode="desktop"
      onPreviewModeChange={vi.fn()}
      settingsOpen={false}
      onToggleSettings={vi.fn()}
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
    // Preview mode is one mutually-exclusive choice, so radios, not items.
    for (const name of ["Desktop preview", "Mobile preview"]) {
      expect(within(menu).getByRole("menuitemradio", { name })).toBeInTheDocument();
    }
  });

  it("marks the active preview mode as checked", async () => {
    const user = userEvent.setup();
    render(<Harness previewMode="mobile" />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    const menu = moreMenu()!;
    expect(
      within(menu).getByRole("menuitemradio", { name: "Mobile preview" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("menuitemradio", { name: "Desktop preview" }),
    ).toHaveAttribute("aria-checked", "false");
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
