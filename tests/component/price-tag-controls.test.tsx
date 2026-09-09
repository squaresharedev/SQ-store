import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_STOREFRONT_CONFIG,
  PRICE_TAG_SIZE_DEFAULT,
  type CardStyleOverrides,
  type StorefrontTheme,
} from "@/types/storefront";
import { PriceTagControls } from "@/components/storefront/PriceTagControls";
import { PriceTagSection } from "@/components/storefront/PriceTagSection";

/**
 * The price tag's own controls, used at two scopes: the theme's Price tag
 * section (patch spreads into the theme) and a product tile's inspector (patch
 * becomes that block's override). What these pin is the patch contract —
 * every edit emits ONLY the field that changed, and clearing a color emits
 * `undefined` rather than a hex — which is what lets a tile store just its
 * differences from the theme, and a theme stay identical to one that never
 * had a color set.
 */

afterEach(cleanup);

const themed = () => structuredClone(DEFAULT_STOREFRONT_CONFIG.theme);

/** Theme scope: the controls edit the theme itself, so `over` is the theme's
 *  own values rather than an override layer. */
function renderControls(
  over: CardStyleOverrides = {},
  theme: StorefrontTheme = themed(),
) {
  const onChange = vi.fn();
  render(
    <PriceTagControls
      theme={{ ...theme, ...over }}
      onChange={onChange}
      scope="theme"
    />,
  );
  return onChange;
}

/** Tile scope: a theme layer plus this tile's overrides. */
function renderTile(overrides: CardStyleOverrides, theme = themed()) {
  const onChange = vi.fn();
  render(
    <PriceTagControls
      theme={theme}
      overrides={overrides}
      onChange={onChange}
      scope={{ blockKey: "p_1" }}
    />,
  );
  return onChange;
}

/** One picker's "follow the theme" dot. All three rows carry one, so every
 *  query has to name its row or it matches three buttons. */
function inheritDot(group: string): HTMLButtonElement {
  return screen
    .getByRole("group", { name: group })
    .querySelector<HTMLButtonElement>('[aria-label^="Use "]')!;
}

describe("PriceTagControls", () => {
  it("emits only the changed field, for every control", async () => {
    const user = userEvent.setup();
    const onChange = renderControls();

    await user.click(screen.getByRole("button", { name: "Serif" }));
    expect(onChange).toHaveBeenLastCalledWith({ priceTagFont: "serif" });

    screen.getByRole("slider", { name: "Price tag size" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({
      priceTagSize: PRICE_TAG_SIZE_DEFAULT + 1,
    });

    screen.getByRole("slider", { name: "Price tag border thickness" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ priceTagBorderWidth: 1 });

    screen.getByRole("slider", { name: "Price tag corner roundness" }).focus();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith({ priceTagRadius: 24 });

    await user.click(screen.getByRole("switch", { name: "Show on hover" }));
    expect(onChange).toHaveBeenLastCalledWith({ priceDisplay: "hover" });

    await user.click(screen.getByRole("button", { name: "Hidden" }));
    expect(onChange).toHaveBeenLastCalledWith({ priceTagPosition: "hidden" });

    // No call ever carries more than its one field.
    for (const call of onChange.mock.calls) {
      expect(Object.keys(call[0])).toHaveLength(1);
    }
  });

  it("sets each of the three colors independently", async () => {
    const user = userEvent.setup();
    const onChange = renderControls();

    for (const [label, key] of [
      ["Tag color swatches", "priceTagColor"],
      ["Text color swatches", "priceTagTextColor"],
      ["Border color swatches", "priceTagBorderColor"],
    ] as const) {
      const group = screen.getByRole("group", { name: label });
      await user.click(
        // Any fixed swatch will do; the point is which FIELD it lands on.
        group.querySelector<HTMLButtonElement>('[aria-label^="Grey"]')!,
      );
      expect(onChange).toHaveBeenLastCalledWith({ [key]: "#737373" });
    }
  });

  it("clears a color back to Auto rather than storing a hex for it", async () => {
    const user = userEvent.setup();
    const onChange = renderControls({ priceTagColor: "#ff0000" });

    // The inherit dot is the ONLY reset affordance (see docs/pickers.md).
    await user.click(inheritDot("Tag color swatches"));
    expect(onChange).toHaveBeenLastCalledWith({ priceTagColor: undefined });
  });

  it("switching to float picks a spot that survives the tile's shape", async () => {
    const user = userEvent.setup();
    // Heavily rounded: the corners are clipped away, so the default float spot
    // must land on the center axis, not a corner that does not exist.
    const onChange = renderControls({ cornerRadius: 100 });
    await user.click(screen.getByRole("button", { name: "On image" }));
    expect(onChange).toHaveBeenLastCalledWith({
      priceTagPosition: "bottom-center",
    });
  });

  it("switching to float lifts the tag off an overlay title bar", async () => {
    const user = userEvent.setup();
    // The title covers the bottom of the image, so the default bottom-left
    // spot would land on the product name. It must come back lifted.
    const onChange = renderControls({ titleStyle: "overlay" });
    await user.click(screen.getByRole("button", { name: "On image" }));
    expect(onChange).toHaveBeenLastCalledWith({ priceTagPosition: "top-left" });
  });

  it("no longer holds a spot board: WHICH spot is the layout board's question", () => {
    // Two boards for one tile is how the title's and the price's ideas of
    // where they could sit came to disagree. This panel keeps the choice a
    // board cannot express (in the bar, on the picture, or nowhere) and hands
    // the rest to TileLayoutBoard, which shows both labels at once.
    renderControls({ titleStyle: "shadow", priceTagPosition: "top-left" });
    expect(screen.queryByRole("group", { name: "Price tag spot" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Price tag top left" }),
    ).toBeNull();
    // The mode picker stays, because "hidden" and "below" are not spots.
    expect(
      screen.getByRole("group", { name: "Price tag placement" }),
    ).toBeInTheDocument();
  });

  it("hides the hover switch when the tag is hidden entirely", () => {
    renderControls({ priceTagPosition: "hidden" });
    expect(screen.queryByRole("switch", { name: "Show on hover" })).toBeNull();
  });

  it("says the size is per-tile, in every placement that has a tile", () => {
    // The tag is sized against the block it sits on, so the number is a size
    // on ONE tile rather than a fixed px, and the slider has to say so or a
    // seller reads a 3x3's chip as the panel disagreeing with the canvas.
    // BOTH placements, because the title band scales too: gating this on the
    // floating one left the default placement — the one a freshly added
    // product actually has — explaining nothing.
    for (const priceTagPosition of ["top-right", "below"] as const) {
      cleanup();
      renderControls({ priceTagPosition });
      expect(
        screen.getByRole("button", { name: "About Size" }),
        `${priceTagPosition} does not explain what Size means`,
      ).toBeInTheDocument();
    }
  });
});

describe("PriceTagControls (tile scope)", () => {
  it("a tile that overrides nothing reads as following the theme", () => {
    // The tile shows the theme's color, but as an OVERRIDE it is unset, so the
    // inherit dot is the active one. Reading the merged style here would mark
    // every tile as overriding the moment the theme picked a color.
    renderTile({}, { ...themed(), priceTagColor: "#00ff00" });
    const dot = inheritDot("Tag color swatches");
    expect(dot).toHaveAttribute("aria-pressed", "true");
    expect(dot.getAttribute("aria-label")).toContain("Theme color");
    expect(dot.style.backgroundColor).toBe("rgb(0, 255, 0)");
  });

  it("a tile that sets its own color stops following the theme", () => {
    renderTile(
      { priceTagColor: "#0000ff" },
      { ...themed(), priceTagColor: "#00ff00" },
    );
    // The dot still shows what clearing would give (the theme's green), but is
    // no longer the active choice.
    const dot = inheritDot("Tag color swatches");
    expect(dot).toHaveAttribute("aria-pressed", "false");
    expect(dot.style.backgroundColor).toBe("rgb(0, 255, 0)");
  });

  it("stores only the changed field, leaving the rest on the theme", async () => {
    const user = userEvent.setup();
    const onChange = renderTile({}, { ...themed(), priceTagFont: "serif" });
    await user.click(screen.getByRole("button", { name: "Mono" }));
    expect(onChange).toHaveBeenLastCalledWith({ priceTagFont: "mono" });
  });
});

describe("PriceTagSection (theme scope)", () => {
  it("spreads a patch into the full theme object", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = themed();
    render(<PriceTagSection theme={theme} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Mono" }));
    expect(onChange).toHaveBeenCalledWith({ ...theme, priceTagFont: "mono" });
  });

  it("drops a cleared color's key instead of storing undefined under it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = { ...themed(), priceTagColor: "#ff0000" };
    render(<PriceTagSection theme={theme} onChange={onChange} />);

    await user.click(inheritDot("Tag color swatches"));
    const next = onChange.mock.calls.at(-1)![0];
    // A theme whose color was set and cleared must round-trip identically to
    // one that never had it — a key holding undefined is not the same thing.
    expect(next).not.toHaveProperty("priceTagColor");
    expect(next).toEqual(themed());
  });
});
