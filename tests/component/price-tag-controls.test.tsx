import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_STOREFRONT_CONFIG,
  PRICE_TAG_SIZE_DEFAULT,
  type CardStyleOverrides,
  type StorefrontTheme,
} from "@/types/storefront";
import { PriceTagControls } from "@/components/storefront/PriceTagControls";
import { PriceTagSection } from "@/components/storefront/PriceTagSection";
import { SaleBadgeControls } from "@/components/storefront/SaleBadgeControls";
import type { Product } from "@/types/product";

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

/** The sale chip's controls at theme scope, as the Sale chip section mounts
 *  them. */
function renderChip(over: CardStyleOverrides = {}) {
  const onChange = vi.fn();
  render(<SaleBadgeControls theme={{ ...themed(), ...over }} onChange={onChange} />);
  return onChange;
}

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

    // The sale chip under it has a "Hidden" of its own, so each is asked for
    // inside its own group.
    await user.click(
      within(screen.getByRole("group", { name: "Price tag placement" })).getByRole("button", { name: "Hidden" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ priceTagPosition: "hidden" });

    // No call ever carries more than its one field.
    for (const call of onChange.mock.calls) {
      expect(Object.keys(call[0])).toHaveLength(1);
    }
  });

  it("edits the sale chip the same way: what it shows, its look, where it sits, and its fill, one field at a time", async () => {
    const user = userEvent.setup();
    const onChange = renderChip();
    const chip = within(document.querySelector<HTMLElement>("[data-sale-badge-controls]")!);

    // Four things it can show, none of them typed.
    const says = within(chip.getByRole("group", { name: "Shows" }));
    expect(says.getAllByRole("button").map((option) => option.textContent)).toEqual([
      "Percentage",
      "Amount",
      "Sale",
      "Hidden",
    ]);
    expect(says.getByRole("button", { name: "Percentage" })).toHaveAttribute("aria-pressed", "true");
    expect(chip.queryByRole("textbox")).toBeNull();
    await user.click(says.getByRole("button", { name: "Amount" }));
    expect(onChange).toHaveBeenLastCalledWith({ saleBadge: "amount" });

    // Four looks, picked from pictures of the real chip saying what it will say.
    const looks = within(chip.getByRole("group", { name: "Style" }));
    expect(looks.getAllByRole("button").map((option) => option.getAttribute("data-option-card"))).toEqual([
      "pill",
      "sticker",
      "flag",
      "ribbon",
    ]);
    expect(looks.getByRole("button", { name: "Pill" })).toHaveAttribute("aria-pressed", "true");
    expect(looks.getAllByText("-20%")).toHaveLength(4);
    await user.click(looks.getByRole("button", { name: "Ribbon" }));
    expect(onChange).toHaveBeenLastCalledWith({ saleBadgeLook: "ribbon" });

    await user.click(chip.getByRole("button", { name: "Sale chip bottom right" }));
    expect(onChange).toHaveBeenLastCalledWith({ saleBadgePosition: "bottom-right" });

    await user.click(
      chip.getByRole("group", { name: "Fill swatches" }).querySelector<HTMLButtonElement>('[aria-label^="Grey"]')!,
    );
    expect(Object.keys(onChange.mock.lastCall![0])).toEqual(["saleBadgeColor"]);
    expect(onChange.mock.lastCall![0].saleBadgeColor).toMatch(/^#[0-9a-f]{6}$/);

    // Back to following the accent clears the field rather than storing it.
    await user.click(chip.getByRole("button", { name: "Use Theme color" }));
    expect(onChange).toHaveBeenLastCalledWith({ saleBadgeColor: undefined });

    // Its words take a colour of their own, and give it back to "Auto": the
    // ink that reads on the fill.
    await user.click(
      chip.getByRole("group", { name: "Text color swatches" }).querySelector<HTMLButtonElement>('[aria-label^="Grey"]')!,
    );
    expect(Object.keys(onChange.mock.lastCall![0])).toEqual(["saleBadgeTextColor"]);
    expect(onChange.mock.lastCall![0].saleBadgeTextColor).toMatch(/^#[0-9a-f]{6}$/);
    await user.click(chip.getByRole("button", { name: "Use Auto" }));
    expect(onChange).toHaveBeenLastCalledWith({ saleBadgeTextColor: undefined });
  });

  it("pictures a tile's own sale in its inspector: what that product's chip will really say", () => {
    const product: Product = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      title: "Alder rocking chair",
      description: "",
      price: 745,
      currency: "EUR",
      status: "active",
      imageUrl: null,
      digitalFileName: null,
      trackStock: false,
      stockQuantity: null,
      lowStockThreshold: 3,
      maxPerOrder: 10,
      sale: { price: 670.5, offerPercent: 10 },
    };
    render(<SaleBadgeControls theme={themed()} overrides={{ saleBadge: "amount" }} onChange={vi.fn()} product={product} />);
    expect(within(screen.getByRole("group", { name: "Style" })).getAllByText("-€74.50")).toHaveLength(4);
  });

  it("lets a tile's chip words follow the storefront's own pick, and says which they follow", () => {
    render(
      <SaleBadgeControls theme={{ ...themed(), saleBadgeTextColor: "#fde047" }} overrides={{}} onChange={vi.fn()} />,
    );
    const chip = within(document.querySelector<HTMLElement>("[data-sale-badge-controls]")!);
    // The fill and the words both follow the storefront: neither is "Auto" here.
    expect(chip.getAllByRole("button", { name: "Use Theme color" })).toHaveLength(2);
    expect(chip.queryByRole("button", { name: "Use Auto" })).toBeNull();
    // The pictures wear it too, so the look a seller picks is the chip they get.
    const look = chip.getByRole("group", { name: "Style" }).querySelector<HTMLElement>("[data-tile-sale-badge]")!;
    expect(look.style.color).toBe("rgb(253, 224, 71)");
  });

  it("offers the sale chip no spot on the price's row, and none of its controls once hidden", () => {
    renderChip({ priceTagPosition: "top-left" });
    const chip = within(document.querySelector<HTMLElement>("[data-sale-badge-controls]")!);
    // The whole top row is the price's: side by side they collide on a small tile.
    expect(chip.queryByRole("button", { name: /^Sale chip top / })).toBeNull();
    // Asked for the price's corner, it is shown where it will really be drawn.
    expect(chip.getByRole("button", { name: "Sale chip bottom left" })).toHaveAttribute("aria-pressed", "true");
    cleanup();

    renderChip({ saleBadge: "hidden" });
    const hidden = within(document.querySelector<HTMLElement>("[data-sale-badge-controls]")!);
    expect(hidden.queryByRole("group", { name: "Style" })).toBeNull();
    expect(hidden.queryByRole("button", { name: /^Sale chip / })).toBeNull();
    expect(hidden.queryByRole("group", { name: "Fill swatches" })).toBeNull();
    expect(hidden.queryByRole("group", { name: "Text color swatches" })).toBeNull();
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

  it("offers one switch for the whole board: chips grow with bigger cards, or stay the same", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const theme = themed();
    render(<PriceTagSection theme={theme} onChange={onChange} />);
    const scale = screen.getByRole("group", { name: "On bigger cards" });
    expect(within(scale).getByRole("button", { name: "Grow" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(scale).getByRole("button", { name: "Stay the same" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...theme, chipScale: "cell" });
    cleanup();

    // Back to the default is no key at all.
    const onBack = vi.fn();
    render(<PriceTagSection theme={{ ...theme, chipScale: "cell" }} onChange={onBack} />);
    await user.click(within(screen.getByRole("group", { name: "On bigger cards" })).getByRole("button", { name: "Grow" }));
    expect(onBack.mock.lastCall![0]).not.toHaveProperty("chipScale");
  });

  it("does not offer the board's chip size on one tile", () => {
    render(<PriceTagControls theme={themed()} overrides={{}} onChange={vi.fn()} scope={{ blockKey: "p_x" }} />);
    expect(screen.queryByRole("group", { name: "On bigger cards" })).toBeNull();
  });
});
