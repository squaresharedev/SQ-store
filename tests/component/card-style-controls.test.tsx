import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_STOREFRONT_CONFIG, resolveCardStyle } from "@/types/storefront";
import { CardStyleControls } from "@/components/storefront/CardStyleControls";
import { CardsSection } from "@/components/storefront/CardsSection";

/**
 * The ONE set of card-appearance controls, used at two scopes: the theme's
 * Cards section (patch spreads into the theme) and a product tile's inspector
 * (patch becomes that block's override). What these pin is the patch
 * contract: every edit emits ONLY the field that changed, which is what lets
 * a tile store just its differences from the theme.
 */

afterEach(cleanup);

const themed = () => structuredClone(DEFAULT_STOREFRONT_CONFIG.theme);

describe("CardStyleControls", () => {
  it("emits only the changed field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CardStyleControls value={resolveCardStyle(themed())} onChange={onChange} />,
    );

    await user.click(screen.getByRole("switch", { name: "Show title" }));
    expect(onChange).toHaveBeenLastCalledWith({ showTitle: false });

    // No call ever carries more than its one field.
    for (const call of onChange.mock.calls) {
      expect(Object.keys(call[0])).toHaveLength(1);
    }
  });

  it("holds no price tag controls: they live in their own panel", async () => {
    render(
      <CardStyleControls value={resolveCardStyle(themed())} onChange={vi.fn()} />,
    );
    // The whole price tag group moved to PriceTagControls. If any of it
    // reappeared here, a seller would have two places to set one value.
    expect(screen.queryByRole("group", { name: "Price tag placement" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Price tag font" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Price tag size" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Show on hover" })).toBeNull();
  });
});

describe("CardsSection (theme scope)", () => {
  it("spreads a controls patch into the full theme object", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = themed();
    render(<CardsSection theme={theme} onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Show title" }));
    expect(onChange).toHaveBeenCalledWith({ ...theme, showTitle: false });
  });

  it("still owns the theme-only sold-out badge switch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = themed();
    render(<CardsSection theme={theme} onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Sold-out badge" }));
    expect(onChange).toHaveBeenCalledWith({ ...theme, soldOutBadge: false });
  });
});
