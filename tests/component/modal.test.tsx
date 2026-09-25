import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderWithoutToasts, screen, fireEvent, cleanup } from "../setup/render";

afterEach(cleanup);
import userEvent from "@testing-library/user-event";
import { Modal } from "@/components/ui/modal";

function renderModal(props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return renderWithoutToasts(
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.title ?? "Dialog title"}
      description={props.description}
    >
      {props.children ?? <button>Action</button>}
    </Modal>,
  );
}

describe("Modal", () => {
  // --- Rendering ---

  it("renders nothing when closed", () => {
    const { container } = renderModal({ open: false, onClose: vi.fn() });
    expect(container.firstChild).toBeNull();
  });

  it("renders role=dialog when open", () => {
    renderModal({ open: true, onClose: vi.fn() });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("dialog has aria-modal=true", () => {
    renderModal({ open: true, onClose: vi.fn() });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("dialog is labelled by its title", () => {
    renderModal({ open: true, onClose: vi.fn(), title: "Confirm deletion" });
    const dialog = screen.getByRole("dialog");
    const titleEl = screen.getByRole("heading", { name: "Confirm deletion" });
    expect(dialog).toHaveAttribute("aria-labelledby", titleEl.id);
  });

  it("dialog has aria-describedby when description is provided", () => {
    renderModal({
      open: true,
      onClose: vi.fn(),
      description: "This action cannot be undone.",
    });
    const dialog = screen.getByRole("dialog");
    const descId = dialog.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)).toHaveTextContent(
      "This action cannot be undone.",
    );
  });

  it("dialog has no aria-describedby when no description", () => {
    renderModal({ open: true, onClose: vi.fn() });
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
  });

  // --- Close interactions ---

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    renderModal({ open: true, onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("backdrop click calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ open: true, onClose });
    // The backdrop is aria-hidden; find it by its class or position in the DOM.
    // It's a sibling of the panel div, both inside the outer fixed container.
    const backdrop = document
      .querySelector(".fixed.inset-0.z-50 > div[aria-hidden]") as HTMLElement;
    expect(backdrop).toBeTruthy();
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Close button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ open: true, onClose });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // --- Focus management ---

  it("focus moves inside the modal on open, to the first real control and never the Close button", () => {
    renderModal({ open: true, onClose: vi.fn() });
    // The Close button is first in DOM order, so "focus the first focusable"
    // used to land there, putting Space and Enter one keystroke from
    // dismissing the dialog before anyone had touched it.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Action" }),
    );
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "Close" }),
    );
  });

  it("falls back to the dialog panel, not Close, when there is no other control", () => {
    renderModal({ open: true, onClose: vi.fn(), children: <p>Just words.</p> });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("initialFocus=\"dialog\" lands on the inert panel even when a control exists", () => {
    renderWithoutToasts(
      <Modal open onClose={vi.fn()} title="T" initialFocus="dialog">
        <input type="radio" aria-label="A choice that a stray Space would record" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("Space right after opening does not close the dialog", async () => {
    const onClose = vi.fn();
    renderModal({ open: true, onClose });
    await userEvent.keyboard(" ");
    expect(onClose).not.toHaveBeenCalled();
  });

  // THE BUG THAT SHIPPED: callers pass an inline onClose, which is a new
  // function on every render. The open-effect depended on it, so every
  // re-render (every keystroke in a form inside the dialog) ran the cleanup,
  // which put focus back on whatever opened the dialog, then stole it into the
  // dialog again. A person typing lost the field after one character.
  it("re-rendering with a new onClose does not move focus out of a field being typed in", async () => {
    function Harness() {
      const [text, setText] = React.useState("");
      return (
        <Modal open onClose={() => setText("")} title="T">
          {/* A control BEFORE the field, like the report dialog's radios. With
              the field first, the buggy effect "stole" focus straight back
              onto the same field and the test could not fail. */}
          <button>first control</button>
          <textarea aria-label="notes" value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      );
    }
    renderWithoutToasts(<Harness />);
    const field = screen.getByLabelText("notes");
    await userEvent.click(field);
    await userEvent.keyboard("two words here");
    expect(field).toHaveValue("two words here");
    expect(document.activeElement).toBe(field);
  });

  it("Escape calls the LATEST onClose, not the one from when it opened", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderWithoutToasts(<Modal open onClose={first} title="T"><button>x</button></Modal>);
    rerender(<Modal open onClose={second} title="T"><button>x</button></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("focus returns to previously focused element when modal closes", () => {
    const onClose = vi.fn();
    const { rerender } = renderWithoutToasts(
      <div>
        <button data-testid="trigger">Open</button>
        <Modal open={false} onClose={onClose} title="Test">
          <button>Action</button>
        </Modal>
      </div>,
    );

    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(
      <div>
        <button data-testid="trigger">Open</button>
        <Modal open={true} onClose={onClose} title="Test">
          <button>Action</button>
        </Modal>
      </div>,
    );

    // Focus should have moved into modal.
    expect(document.activeElement).not.toBe(trigger);

    // Close the modal.
    rerender(
      <div>
        <button data-testid="trigger">Open</button>
        <Modal open={false} onClose={onClose} title="Test">
          <button>Action</button>
        </Modal>
      </div>,
    );

    // Focus should return to trigger.
    expect(document.activeElement).toBe(trigger);
  });

  // --- Focus trap ---

  it("Tab from last focusable wraps to first", () => {
    renderModal({
      open: true,
      onClose: vi.fn(),
      children: <button>Second</button>,
    });

    const _buttons = screen.getAllByRole("button");
    // Focusable order: Close, Second
    const closeBtn = screen.getByRole("button", { name: "Close" });
    const secondBtn = screen.getByRole("button", { name: "Second" });

    // Focus the last button then press Tab.
    secondBtn.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("Shift+Tab from first focusable wraps to last", () => {
    renderModal({
      open: true,
      onClose: vi.fn(),
      children: <button>Second</button>,
    });

    const closeBtn = screen.getByRole("button", { name: "Close" });
    const secondBtn = screen.getByRole("button", { name: "Second" });

    // Focus the first button then press Shift+Tab.
    closeBtn.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(secondBtn);
  });
});
