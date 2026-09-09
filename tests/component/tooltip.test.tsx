import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoTip } from "@/components/ui/InfoTip";

afterEach(cleanup);

/**
 * The hover label for icon-only controls (the layer moves, the device switch,
 * the panel tabs). What is pinned here is the DIVISION between it and the "?"
 * InfoTip, because the two look alike and behave deliberately differently:
 *
 *   - a Tooltip repeats the control's own accessible name, so it is decorative
 *     and must NOT be announced a second time;
 *   - an InfoTip carries something the control does not say, so it IS in the
 *     a11y tree and opens on tap.
 *
 * A Tooltip that ever gains role="tooltip" would be a screen reader reading
 * "Send to back, Send to back", and every `getByRole("tooltip")` in the suite
 * would suddenly find two.
 */
function renderTip(label = "Send to back") {
  return render(
    <Tooltip label={label}>
      <button type="button" aria-label={label}>
        icon
      </button>
    </Tooltip>,
  );
}

const trigger = (name = "Send to back") =>
  screen.getByRole("button", { name });

describe("Tooltip", () => {
  it("shows nothing at rest", () => {
    renderTip();
    expect(screen.queryByText("Send to back", { selector: "[data-tooltip]" }))
      .toBeNull();
  });

  it("reveals the label on a mouse hover and hides it on leave", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.hover(trigger());
    expect(document.querySelector("[data-tooltip]")).toHaveTextContent(
      "Send to back",
    );
    await user.unhover(trigger());
    expect(document.querySelector("[data-tooltip]")).toBeNull();
  });

  it("reveals it on keyboard focus and hides it on blur", () => {
    renderTip();
    fireEvent.focus(trigger());
    expect(document.querySelector("[data-tooltip]")).not.toBeNull();
    fireEvent.blur(trigger());
    expect(document.querySelector("[data-tooltip]")).toBeNull();
  });

  it("Escape dismisses it", () => {
    renderTip();
    fireEvent.focus(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-tooltip]")).toBeNull();
  });

  it("stays out of the a11y tree: the trigger's aria-label is the one name", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.hover(trigger());
    // NOT role="tooltip" — that is the InfoTip's, and a second one would make
    // every getByRole("tooltip") in the suite ambiguous.
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.querySelector("[data-tooltip]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(trigger()).not.toHaveAttribute("aria-describedby");
  });

  it("does not open on touch — the tap belongs to the button", () => {
    renderTip();
    fireEvent.pointerEnter(trigger(), { pointerType: "touch" });
    expect(document.querySelector("[data-tooltip]")).toBeNull();
    fireEvent.click(trigger());
    expect(document.querySelector("[data-tooltip]")).toBeNull();
  });

  it("renders in a portal on <body>, so a scrolling panel cannot clip it", async () => {
    const user = userEvent.setup();
    renderTip();
    await user.hover(trigger());
    const bubble = document.querySelector("[data-tooltip]")!;
    expect(bubble.parentElement).toBe(document.body);
    expect(bubble.className).toContain("fixed");
  });

  it("wears the same bubble as the '?' — rounded-sm, never a pill", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Tooltip label="Send to back">
          <button type="button" aria-label="Send to back">
            icon
          </button>
        </Tooltip>
        <InfoTip label="How layering works">
          Layers decide only what paints on top.
        </InfoTip>
      </div>,
    );

    await user.hover(trigger());
    expect(document.querySelector("[data-tooltip]")!.className).toContain(
      "rounded-sm",
    );
    await user.unhover(trigger());

    await user.hover(screen.getByRole("button", { name: "How layering works" }));
    const info = screen.getByRole("tooltip");
    expect(info.className).toContain("rounded-sm");
    // Both carry the point: one decorative span each, rotated 45°.
    expect(info.querySelector("span[aria-hidden='true']")?.className).toContain(
      "rotate-45",
    );
  });

  /**
   * The storefront canvas pans by writing a CSS transform straight to the
   * stage element every animation frame (useCanvasViewport) — no scroll or
   * resize event fires for that. A trigger riding along used to leave its
   * tooltip behind, stuck at the screen position it opened at. Placement now
   * re-measures every animation frame instead of waiting for scroll/resize,
   * so this drives that directly: move the trigger (jsdom has no layout
   * engine, so "moving" it means stubbing its own getBoundingClientRect,
   * exactly what a real CSS transform would change) and confirm the bubble's
   * position is recomputed without any scroll or resize event at all.
   */
  it("keeps following its trigger across animation frames, with no scroll or resize event", async () => {
    renderTip();
    fireEvent.focus(trigger());
    const bubble = () => document.querySelector("[data-tooltip]") as HTMLElement;
    expect(bubble()).not.toBeNull();

    const anchor = trigger().parentElement!;
    anchor.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 100,
        bottom: 130,
        right: 150,
        width: 50,
        height: 30,
        x: 100,
        y: 100,
        toJSON() {},
      }) as DOMRect;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = { top: bubble().style.top, left: bubble().style.left };

    anchor.getBoundingClientRect = () =>
      ({
        top: 300,
        left: 300,
        bottom: 330,
        right: 350,
        width: 50,
        height: 30,
        x: 300,
        y: 300,
        toJSON() {},
      }) as DOMRect;
    // No scroll, no resize — just letting the rAF loop tick.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(bubble().style.top).not.toBe(before.top);
    expect(bubble().style.left).not.toBe(before.left);
    expect(bubble().style.top).toBe("338px");
    expect(bubble().style.left).toBe("325px");
  });
});
