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

    await user.click(screen.getByRole("button", { name: "Pill" }));
    expect(onChange).toHaveBeenLastCalledWith({ priceTagStyle: "pill" });

    await user.click(screen.getByRole("switch", { name: "Show title" }));
    expect(onChange).toHaveBeenLastCalledWith({ showTitle: false });

    await user.click(screen.getByRole("button", { name: "L" }));
    expect(onChange).toHaveBeenLastCalledWith({ priceTagSize: "lg" });

    // No call ever carries more than its one field.
    for (const call of onChange.mock.calls) {
      expect(Object.keys(call[0])).toHaveLength(1);
    }
  });

  it("switching price tag mode to float picks a coerced concrete spot", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Heavily rounded: corners are clipped away, so the default float spot
    // must land on the center axis, not a corner that does not exist.
    render(
      <CardStyleControls
        value={resolveCardStyle(themed(), { cornerRadius: 100 })}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "On image" }));
    expect(onChange).toHaveBeenLastCalledWith({
      priceTagPosition: "bottom-center",
    });
  });
});

describe("CardsSection (theme scope)", () => {
  it("spreads a controls patch into the full theme object", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = themed();
    render(<CardsSection theme={theme} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Pill" }));
    expect(onChange).toHaveBeenCalledWith({ ...theme, priceTagStyle: "pill" });
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
