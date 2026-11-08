import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { LayoutSection } from "@/components/storefront/LayoutSection";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontTheme } from "@/types/storefront";

/**
 * The Canvas section's phone arrangement: one switch that turns the board's own
 * phone layout on (at the width the automatic reflow uses) or off again, and
 * the phone width once it is on. What the designer does with the answer is
 * pinned in tests/unit/storefront/mobile-layout.test.ts.
 */

afterEach(cleanup);

function renderSection(theme: StorefrontTheme, onPhoneColumnsChange?: (columns: number | null) => void) {
  render(
    <LayoutSection
      theme={theme}
      onChange={vi.fn()}
      onCanvasChange={vi.fn()}
      onPhoneColumnsChange={onPhoneColumnsChange}
      showGrid
      onShowGridChange={vi.fn()}
    />,
  );
}

const theme = DEFAULT_STOREFRONT_CONFIG.theme;

describe("LayoutSection phone arrangement", () => {
  it("is off by default, says so, and turns on at the automatic width", async () => {
    const onPhoneColumnsChange = vi.fn();
    renderSection(theme, onPhoneColumnsChange);
    const toggle = screen.getByRole("switch", { name: "Arrange for phones" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Phones arrange this board automatically.")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Phone width in blocks" })).toBeNull();

    await userEvent.click(toggle);
    expect(onPhoneColumnsChange).toHaveBeenCalledWith(4);
  });

  it("once on, shows the phone width and turns off back to automatic", async () => {
    const onPhoneColumnsChange = vi.fn();
    renderSection({ ...theme, mobileColumns: 3 }, onPhoneColumnsChange);
    expect(screen.getByRole("slider", { name: "Phone width in blocks" })).toHaveAttribute("aria-valuenow", "3");
    expect(screen.queryByText("Phones arrange this board automatically.")).toBeNull();

    await userEvent.click(screen.getByRole("switch", { name: "Arrange for phones" }));
    expect(onPhoneColumnsChange).toHaveBeenCalledWith(null);
  });

  it("is left out where nothing can arrange the board (the dev gallery)", () => {
    renderSection(theme);
    expect(screen.queryByRole("switch", { name: "Arrange for phones" })).toBeNull();
  });
});
