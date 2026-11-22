import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "../setup/render";
import { BoardMotion } from "@/components/storefront/BoardMotion";
import { BOARD_MOTION_ATTRIBUTE } from "@/lib/storefront/motion";

afterEach(cleanup);

describe("BoardMotion", () => {
  it("renders nothing for a storefront saved before motion, or set to none", () => {
    // Wrapped, because the shared render puts the toast region in too.
    const { container, rerender } = render(<div data-testid="slot"><BoardMotion /></div>);
    const slot = () => container.querySelector("[data-testid=slot]");
    expect(slot()?.innerHTML).toBe("");
    rerender(<div data-testid="slot"><BoardMotion motion="none" /></div>);
    expect(slot()?.innerHTML).toBe("");
  });

  it("renders one hidden anchor naming the preset, before the grid it scopes", () => {
    const { container } = render(
      <main>
        <BoardMotion motion="lively" />
        <ul>
          <li data-grid-cell="" />
        </ul>
      </main>,
    );
    const anchor = container.querySelector(`[${BOARD_MOTION_ATTRIBUTE}]`);
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute(BOARD_MOTION_ATTRIBUTE)).toBe("lively");
    expect(anchor).toHaveAttribute("hidden");
    // The CSS reaches the cells through `[data-board-motion] ~ *`.
    expect(anchor?.nextElementSibling?.querySelector("[data-grid-cell]")).not.toBeNull();
  });
});
