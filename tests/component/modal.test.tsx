import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

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
  return render(
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

  it("focus moves inside modal on open (to first focusable: Close button)", () => {
    renderModal({ open: true, onClose: vi.fn() });
    // The Close button is the first focusable element in the panel.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
  });

  it("focus returns to previously focused element when modal closes", () => {
    const onClose = vi.fn();
    const { rerender } = render(
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
