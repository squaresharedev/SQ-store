import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; provide a stub.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
import userEvent from "@testing-library/user-event";
import { Popover } from "@/components/ui/Popover";

function renderPopover(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
  variant?: "sheet" | "anchored";
}) {
  return render(
    <div>
      <Popover
        open={props.open}
        onOpenChange={props.onOpenChange}
        label="Test popover"
        variant={props.variant}
        trigger={
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={props.open}
            onClick={() => props.onOpenChange(!props.open)}
          >
            Open
          </button>
        }
      >
        {props.children ?? (
          <div>
            <button>First</button>
            <button>Second</button>
          </div>
        )}
      </Popover>
      <button data-testid="outside">Outside</button>
    </div>,
  );
}

describe("Popover", () => {
  // --- Rendering ---

  it("renders trigger when closed", () => {
    renderPopover({ open: false, onOpenChange: vi.fn() });
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog panel when open", () => {
    renderPopover({ open: true, onOpenChange: vi.fn() });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("dialog panel has aria-modal=true", () => {
    renderPopover({ open: true, onOpenChange: vi.fn() });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("dialog is labelled via aria-label", () => {
    renderPopover({ open: true, onOpenChange: vi.fn() });
    expect(screen.getByRole("dialog", { name: "Test popover" })).toBeInTheDocument();
  });

  // --- Open / close via trigger ---

  it("trigger has aria-expanded=true when open", () => {
    renderPopover({ open: true, onOpenChange: vi.fn() });
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("trigger has aria-expanded=false when closed", () => {
    renderPopover({ open: false, onOpenChange: vi.fn() });
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("clicking trigger calls onOpenChange(true)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPopover({ open: false, onOpenChange });
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  // --- Esc closes ---

  it("Escape key calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    renderPopover({ open: true, onOpenChange });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // --- Click outside closes ---

  it("pointerdown outside the popover root calls onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPopover({ open: true, onOpenChange });
    await user.click(screen.getByTestId("outside"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("pointerdown inside the popover does NOT close it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPopover({ open: true, onOpenChange });
    await user.click(screen.getByRole("button", { name: "First" }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  // --- Focus management ---

  it("focus moves into the panel on open (first focusable)", () => {
    renderPopover({ open: true, onOpenChange: vi.fn() });
    // First focusable in panel is the "First" button.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "First" }),
    );
  });

  it("focus lands on [data-autofocus] element when present", () => {
    const onOpenChange = vi.fn();
    render(
      <Popover
        open={true}
        onOpenChange={onOpenChange}
        label="Autofocus test"
        trigger={<button type="button">Open</button>}
      >
        <div>
          <button>Skip me</button>
          <button data-autofocus="">Focus me</button>
        </div>
      </Popover>,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Focus me" }),
    );
  });

  it("focus returns to trigger after popover closes", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <div>
        <Popover
          open={false}
          onOpenChange={onOpenChange}
          label="Test"
          trigger={
            <button type="button" data-testid="trigger">
              Open
            </button>
          }
        >
          <button>Inside</button>
        </Popover>
      </div>,
    );

    const trigger = screen.getByTestId("trigger");
    trigger.focus();

    // Open
    rerender(
      <div>
        <Popover
          open={true}
          onOpenChange={onOpenChange}
          label="Test"
          trigger={
            <button type="button" data-testid="trigger">
              Open
            </button>
          }
        >
          <button>Inside</button>
        </Popover>
      </div>,
    );

    // Focus inside
    expect(document.activeElement).not.toBe(trigger);

    // Close
    rerender(
      <div>
        <Popover
          open={false}
          onOpenChange={onOpenChange}
          label="Test"
          trigger={
            <button type="button" data-testid="trigger">
              Open
            </button>
          }
        >
          <button>Inside</button>
        </Popover>
      </div>,
    );

    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// Outside-click must survive ancestors that swallow the event
// ---------------------------------------------------------------------------

describe("Popover outside click vs stopPropagation", () => {
  /**
   * The designer canvas calls stopPropagation on pointerdown (so a resize
   * gesture can't also start a move). A bubble-phase document listener never
   * sees those events and the popover stays stuck open, so the outside-click
   * listener CAPTURES. Regression guard for that.
   */
  function renderInsideSwallowingAncestor(onOpenChange: (open: boolean) => void) {
    return render(
      <div onPointerDownCapture={(event) => event.stopPropagation()}>
        <Popover
          open
          onOpenChange={onOpenChange}
          label="Test popover"
          trigger={<button type="button">Open</button>}
        >
          <button>Inside</button>
        </Popover>
        <button data-testid="outside">Outside</button>
      </div>,
    );
  }

  it("closes on an outside click even when an ancestor stops propagation", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderInsideSwallowingAncestor(onOpenChange);

    await user.click(screen.getByTestId("outside"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still does NOT close for a click inside the panel", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderInsideSwallowingAncestor(onOpenChange);

    await user.click(screen.getByRole("button", { name: "Inside" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
