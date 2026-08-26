import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_STOREFRONT_CONFIG,
  TITLE_INSET_AUTO,
  resolveCardStyle,
} from "@/types/storefront";
import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_VALUES,
} from "@/lib/storefront/layout-presets";
import { priceSpots, spotAfterArrow } from "@/lib/storefront/tile-spots";
import { CardStyleControls } from "@/components/storefront/CardStyleControls";
import { CardsSection } from "@/components/storefront/CardsSection";
import { SoldOutSection } from "@/components/storefront/SoldOutSection";

/**
 * The ONE set of card-appearance controls, used at two scopes: the theme's
 * Cards section (patch spreads into the theme) and a product tile's inspector
 * (patch becomes that block's override). What these pin is the patch
 * contract: every edit emits ONLY the field that changed, which is what lets
 * a tile store just its differences from the theme.
 */

afterEach(cleanup);

const themed = () => structuredClone(DEFAULT_STOREFRONT_CONFIG.theme);

/** Everything that shapes a label rather than placing it is folded away, so a
 *  test that wants those controls has to open the drawer first, exactly as a
 *  seller would. */
async function openFineTuning(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Fine tuning/ }));
}

describe("CardStyleControls", () => {
  it("emits only the changed field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CardStyleControls value={resolveCardStyle(themed())} onChange={onChange} />,
    );

    await openFineTuning(user);
    await user.click(screen.getByRole("switch", { name: "Show title" }));
    expect(onChange).toHaveBeenLastCalledWith({ showTitle: false });

    // No call ever carries more than its one field.
    for (const call of onChange.mock.calls) {
      expect(Object.keys(call[0])).toHaveLength(1);
    }
  });

  it("leads with the layouts, which set the four fields together", async () => {
    // The one exception to the patch-per-field rule, and the reason presets
    // exist: those four fields only make sense agreeing with each other.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CardStyleControls value={resolveCardStyle(themed())} onChange={onChange} />,
    );

    const row = screen.getByRole("group", { name: "Layout" });
    expect(within(row).getAllByRole("button")).toHaveLength(LAYOUT_PRESETS.length);
    await user.click(within(row).getByRole("button", { name: "Gallery" }));
    expect(onChange).toHaveBeenLastCalledWith(LAYOUT_PRESET_VALUES.gallery);
  });

  it("lights the layout the tile is on, and none once it is tuned past them", () => {
    const { rerender } = render(
      <CardStyleControls
        value={resolveCardStyle(themed(), LAYOUT_PRESET_VALUES.caption)}
        onChange={vi.fn()}
      />,
    );
    const pressed = () =>
      within(screen.getByRole("group", { name: "Layout" }))
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed()).toHaveLength(1);

    rerender(
      <CardStyleControls
        value={resolveCardStyle(themed(), {
          ...LAYOUT_PRESET_VALUES.caption,
          // One nudge past the preset and the row must stop claiming it.
          priceTagPosition: "middle-center",
        })}
        onChange={vi.fn()}
      />,
    );
    expect(pressed()).toHaveLength(0);
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

  it("puts both labels on ONE board and arrows either of them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CardStyleControls
        value={resolveCardStyle(themed(), {
          titleStyle: "overlay",
          titlePosition: "bottom-left",
          priceTagPosition: "top-right",
        })}
        onChange={onChange}
      />,
    );

    const board = screen.getByRole("group", { name: "Label positions" });
    const title = within(board).getByRole("button", { name: /^Title at/ });
    const price = within(board).getByRole("button", { name: /^Price at/ });

    title.focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({ titlePosition: "top-left" });

    price.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith({ priceTagPosition: "top-center" });
  });

  it("keeps the price out of the row the title band holds", () => {
    // The rule the two separate boards could only state in a hint line: with
    // the title across the bottom, the price cannot be arrowed into it.
    render(
      <CardStyleControls
        value={resolveCardStyle(themed(), {
          titleStyle: "overlay",
          titlePosition: "bottom-left",
          priceTagPosition: "middle-center",
        })}
        onChange={vi.fn()}
      />,
    );
    expect(
      spotAfterArrow("middle-center", "ArrowDown", priceSpots(0, "bottom")),
    ).toBe("middle-center");
  });

  it("shows no price token at all when the price is hidden", () => {
    render(
      <CardStyleControls
        value={resolveCardStyle(themed(), { priceTagPosition: "hidden" })}
        onChange={vi.fn()}
      />,
    );
    const board = screen.getByRole("group", { name: "Label positions" });
    expect(within(board).queryByRole("button", { name: /^Price at/ })).toBeNull();
  });

  it("treats the band's edge spacing as auto until the seller takes it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <CardStyleControls value={resolveCardStyle(themed())} onChange={onChange} />,
    );

    await openFineTuning(user);
    // Auto is a state, not a number: nothing is stored until it is moved.
    expect(screen.getByText(/^Auto/)).toBeVisible();
    // Keyboard rather than a click: a pointer press sets from its own x, and
    // what is being pinned here is that the slider STARTS where auto had it.
    const slider = screen.getByRole("slider", { name: "Title edge spacing" });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({
      titleInset: TITLE_INSET_AUTO.min + 1,
    });

    // And going back to auto clears the field rather than storing a number.
    rerender(
      <CardStyleControls
        value={resolveCardStyle(themed(), { titleInset: 12 })}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Auto" }));
    expect(onChange).toHaveBeenLastCalledWith({ titleInset: undefined });
  });

  it("hides the shaping controls until they are asked for", () => {
    // The drawer is what keeps five settings from standing between a seller
    // and the layout row that answers most of their question.
    render(
      <CardStyleControls value={resolveCardStyle(themed())} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("switch", { name: "Show title" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Title edge spacing" })).toBeNull();
    // The two that place rather than shape stay in the open.
    expect(screen.getByRole("group", { name: "Layout" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Label positions" })).toBeVisible();
  });
});

describe("CardsSection (theme scope)", () => {
  it("spreads a controls patch into the full theme object", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = themed();
    render(<CardsSection theme={theme} onChange={onChange} />);

    await openFineTuning(user);
    await user.click(screen.getByRole("switch", { name: "Show title" }));
    expect(onChange).toHaveBeenCalledWith({ ...theme, showTitle: false });
  });

  it("no longer carries the sold-out badge, which moved to SoldOutSection", () => {
    render(<CardsSection theme={themed()} onChange={vi.fn()} />);

    expect(
      screen.queryByRole("switch", { name: /sold.?out/i }),
    ).not.toBeInTheDocument();
  });
});

/**
 * The two switches that decide what a sold-out product does. They used to sit
 * in different sections ("Cards" and "Advanced"), which is why they are pinned
 * together here: whether a product is shown and whether it is labelled is one
 * decision taken twice, and either switch alone cannot answer it.
 */
describe("SoldOutSection", () => {
  it("owns both sold-out switches and patches the theme", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = themed();
    render(<SoldOutSection theme={theme} onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Show badge" }));
    expect(onChange).toHaveBeenCalledWith({ ...theme, soldOutBadge: false });

    await user.click(screen.getByRole("switch", { name: "Hide from buyers" }));
    expect(onChange).toHaveBeenCalledWith({ ...theme, hideSoldOut: true });
  });

  it("says the badge is moot while sold-out products are hidden", () => {
    render(
      <SoldOutSection
        theme={{ ...themed(), hideSoldOut: true }}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Only applies while sold-out products are shown."),
    ).toBeInTheDocument();
  });
});
