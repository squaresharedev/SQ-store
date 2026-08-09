import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoTip } from "@/components/ui/InfoTip";

afterEach(cleanup);

const COPY = "Saving updates it everywhere it appears.";

function renderTip() {
  return render(
    <div>
      <InfoTip label="Where a change lands">{COPY}</InfoTip>
      <button data-testid="outside">Outside</button>
    </div>,
  );
}

const trigger = () => screen.getByRole("button", { name: "Where a change lands" });

describe("InfoTip", () => {
  // --- Closed by default ---

  it("renders a labelled trigger with no tooltip showing", () => {
    renderTip();
    expect(trigger()).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByText(COPY)).not.toBeInTheDocument();
  });

  it("trigger is type=button so it never submits a surrounding form", () => {
    renderTip();
    expect(trigger()).toHaveAttribute("type", "button");
  });

  // --- Mouse: hover reveals ---

  it("hovering reveals the copy", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.hover(trigger());
    expect(screen.getByRole("tooltip")).toHaveTextContent(COPY);
  });

  it("moving the pointer away hides it again", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.hover(trigger());
    await user.unhover(trigger());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("describes the trigger while open, and not while closed", async () => {
    const user = userEvent.setup();
    renderTip();
    expect(trigger()).not.toHaveAttribute("aria-describedby");
    await user.hover(trigger());
    expect(trigger()).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("tooltip").id,
    );
  });

  // --- Touch: there is no hover, so the tap has to do it ---

  it("a tap (no hover first) reveals the copy", () => {
    renderTip();
    // A touch pointer must not be treated as a hover...
    fireEvent.pointerOver(trigger(), { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    // ...the tap itself is what opens it.
    fireEvent.click(trigger());
    expect(screen.getByRole("tooltip")).toHaveTextContent(COPY);
  });

  it("a tapped tip survives the finger leaving the trigger", () => {
    renderTip();
    fireEvent.click(trigger());
    fireEvent.pointerOut(trigger(), { pointerType: "touch" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("pressing outside closes a tapped tip", () => {
    renderTip();
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("tapping the trigger again closes it", () => {
    renderTip();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // --- Keyboard ---

  it("keyboard focus reveals the copy and blur hides it", () => {
    renderTip();
    fireEvent.focus(trigger());
    expect(screen.getByRole("tooltip")).toHaveTextContent(COPY);
    fireEvent.blur(trigger());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("Escape closes it", () => {
    renderTip();
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // --- Placement ---

  it("places the bubble as a fixed element (never clipped by a scroll box)", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.hover(trigger());
    const bubble = screen.getByRole("tooltip");
    expect(bubble.className).toContain("fixed");
    // Placed by the layout effect before paint, so it is never left hidden.
    expect(bubble.style.visibility).toBe("");
    expect(bubble.style.top).not.toBe("");
  });

  it("renders the bubble outside its trigger's DOM subtree (portal)", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.hover(trigger());
    expect(trigger().contains(screen.getByRole("tooltip"))).toBe(false);
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  });

  // --- Reuse safety ---

  it("a click does not reach a clickable ancestor", () => {
    let ancestorClicks = 0;
    render(
      <div onClick={() => (ancestorClicks += 1)}>
        <InfoTip label="Where a change lands">{COPY}</InfoTip>
      </div>,
    );
    fireEvent.click(trigger());
    expect(ancestorClicks).toBe(0);
  });
});
