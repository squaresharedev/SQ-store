import { describe, it, expect } from "vitest";
import { priceTagChipStyle } from "@/components/storefront/config-maps";
import { contrastRatio, MIN_LEGIBLE_CONTRAST } from "@/lib/format/color";
import {
  PRICE_TAG_DEFAULT_FILL,
  PRICE_TAG_SHADOW_TEXT,
  TILE_LABEL_AUTO_SCALE,
} from "@/types/storefront";

/**
 * THE ONE THING A PRODUCT TILE MAY NEVER DO IS HIDE THE PRICE.
 *
 * A buyer who cannot see what something costs cannot buy it, so the chip's ink
 * is not left to the sum of a seller's choices, a resolver's default, and
 * whatever placement the tag happens to be in mid-drag. Whatever those three
 * agree on, what is painted has to be readable against what it is painted on.
 *
 * The blank chip that prompted this was the drag case: a tag being lifted out
 * of a `shadow` title band kept the white ink that band needs while already
 * wearing the white backing a floated tag gets. That specific pairing is fixed
 * at the source (ProductTileContent resolves both from the LIVE placement now,
 * see storefront-tile-style.test.tsx), and the floor below is the backstop
 * that holds for every other way of arriving at the same place.
 */

const CHIP = {
  priceTagSize: 10,
  priceTagBorderWidth: 0,
  priceTagRadius: 2,
};

function ink(
  card: Partial<typeof CHIP> & Record<string, unknown>,
  fallback: { fill: string; text: string },
  backdrop: string,
): string {
  return priceTagChipStyle(
    { ...CHIP, ...card },
    fallback,
    backdrop,
  ).color as string;
}

describe("the price tag can never be painted invisible", () => {
  it("rescues white ink that landed on the white backing a floated tag wears", () => {
    // THE REPORTED BUG, as the chip sees it: both halves resolved to white and
    // the chip rendered as an empty rectangle over the photo.
    const color = ink(
      {},
      { fill: PRICE_TAG_DEFAULT_FILL, text: PRICE_TAG_SHADOW_TEXT },
      PRICE_TAG_DEFAULT_FILL,
    );
    expect(color).not.toBe(PRICE_TAG_SHADOW_TEXT);
    expect(contrastRatio(color, PRICE_TAG_DEFAULT_FILL)).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_CONTRAST,
    );
  });

  it("rescues a seller's own colour, not just an automatic one", () => {
    // A seller who picks white text and a white tag has made the price
    // vanish just as completely as any resolver could. Their intent is not
    // in doubt, and it still cannot be honoured.
    const color = ink(
      { priceTagTextColor: "#fdfdfd", priceTagColor: "#ffffff" },
      { fill: PRICE_TAG_DEFAULT_FILL, text: "#171717" },
      "#ffffff",
    );
    expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_CONTRAST,
    );
  });

  it("rescues dark ink sitting on a dark tag, the other direction", () => {
    const color = ink(
      { priceTagTextColor: "#1c1c1c", priceTagColor: "#171717" },
      { fill: PRICE_TAG_DEFAULT_FILL, text: "#171717" },
      "#171717",
    );
    expect(contrastRatio(color, "#171717")).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_CONTRAST,
    );
  });

  it("rescues an unfilled price against the band it actually sits on", () => {
    // In the title bar the chip has no fill of its own, so the backdrop is
    // the band: white ink there is invisible even though nothing about the
    // chip is white.
    const color = ink(
      { priceTagTextColor: "#ffffff" },
      { fill: "transparent", text: "#171717" },
      "#ffffff",
    );
    expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_CONTRAST,
    );
  });

  it("leaves every readable choice exactly as the seller made it", () => {
    // The floor is WCAG's large-text bar and no stricter: this exists to keep
    // the price visible, not to police taste. A muted grey on white, a brand
    // colour, an accent — all survive untouched.
    for (const [text, fill] of [
      ["#6b7280", "#ffffff"],
      ["#2563eb", "#ffffff"],
      ["#ffffff", "#171717"],
      ["#fbbf24", "#1c1917"],
    ] as const) {
      expect(ink({ priceTagTextColor: text, priceTagColor: fill }, { fill, text }, fill)).toBe(
        text,
      );
    }
  });

  it("still scales the chip whatever the ink decision was", () => {
    const style = priceTagChipStyle(
      CHIP,
      { fill: PRICE_TAG_DEFAULT_FILL, text: "#ffffff" },
      PRICE_TAG_DEFAULT_FILL,
    ) as Record<string, string>;
    expect(style["--tag-font-size"]).toContain("cqmin");
    expect(style["--tag-font-size"]).toContain(
      `${CHIP.priceTagSize * TILE_LABEL_AUTO_SCALE.max}px`,
    );
  });
});
