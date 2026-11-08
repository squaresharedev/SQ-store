import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ShortcutsDialog } from "@/components/storefront/ShortcutsDialog";

/**
 * The designer's keyboard shortcuts list. "?" opens it from anywhere outside a
 * field, the way most editors do, and it lists the shortcuts no button names
 * (Save, Delete, the layer keys, Space to pan) rather than repeating the ones
 * undo, redo and zoom already show in their tips.
 */

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <label>
        Store name
        <input type="text" />
      </label>
      <ShortcutsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

const dialog = () => screen.queryByRole("dialog", { name: "Keyboard shortcuts" });

describe("ShortcutsDialog", () => {
  it("opens on ? outside a field and lists the shortcuts no button names", () => {
    render(<Harness />);
    expect(dialog()).toBeNull();

    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    const open = dialog()!;
    expect(open).toBeInTheDocument();
    for (const label of ["Save", "Remove the selected blocks", "Move around the canvas"]) {
      expect(within(open).getByText(label)).toBeInTheDocument();
    }
    // Keys are drawn as keys, not run into the sentence.
    expect(within(open).getByText("Delete").tagName).toBe("KBD");
  });

  it("leaves ? alone while someone is typing", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Store name" }), {
      key: "?",
      shiftKey: true,
    });
    expect(dialog()).toBeNull();
  });

  it("closes on Done", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    await user.click(within(dialog()!).getByRole("button", { name: "Done" }));
    expect(dialog()).toBeNull();
  });
});
