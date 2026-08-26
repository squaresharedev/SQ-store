import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DesignPanel } from "@/components/storefront/DesignPanel";

/**
 * The two scopes the right-hand panel edits in.
 *
 * The panel used to stack the selected block's editor on top of every global
 * section, which put a tile's own "Price tag" directly above the theme's, with
 * nothing on screen saying which one won. These pin the fix: one scope visible
 * at a time, named by the tab that selected it.
 */

afterEach(cleanup);

function Harness({ initialSelection = "" }: { initialSelection?: string }) {
  const [selectionKey, setSelectionKey] = useState(initialSelection);
  return (
    <>
      <button type="button" onClick={() => setSelectionKey("block-2")}>
        select another block
      </button>
      <DesignPanel
        panelOpen
        onPanelOpenChange={vi.fn()}
        panelWidth={320}
        minWidth={260}
        maxWidth={560}
        onResizePointerDown={vi.fn()}
        onResizeKeyDown={vi.fn()}
        selectionKey={selectionKey}
        showInspector={selectionKey !== ""}
        inspectorTitle="Product"
        onCloseInspector={vi.fn()}
        inspectorHiddenOnMobile={false}
        inspector={<p>inspector body</p>}
        settingsOpen={false}
        onCloseSettings={vi.fn()}
        controls={<p>global settings</p>}
      />
    </>
  );
}

describe("DesignPanel", () => {
  it("offers no tab strip when there is nothing selected", () => {
    render(<Harness />);

    // A tab bar with one choice is furniture: with no selection there is only
    // one scope, so the global settings simply ARE the panel.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("global settings")).toBeInTheDocument();
  });

  it("opens on the selection and switches scope by tab", async () => {
    const user = userEvent.setup();
    render(<Harness initialSelection="block-1" />);

    expect(screen.getByRole("tab", { name: "Selection" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "Design" }));
    expect(screen.getByRole("tab", { name: "Design" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("returns to the selection when a different block is picked", async () => {
    const user = userEvent.setup();
    render(<Harness initialSelection="block-1" />);

    await user.click(screen.getByRole("tab", { name: "Design" }));
    // Reaching for a block on the canvas is a request to see that block, so a
    // new selection pulls the panel back rather than leaving the seller on the
    // theme settings wondering why nothing responded.
    await user.click(screen.getByRole("button", { name: /select another/ }));

    expect(screen.getByRole("tab", { name: "Selection" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
