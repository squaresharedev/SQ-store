/**
 * The checkout's visual pieces: the version chips, the retired checkout settings
 * still loading, and the free-delivery nudge that must never promise a price the
 * quote would not give.
 */
import { describe, expect, it } from "vitest";
import { english } from "../setup/translate";
import { selectionChips, previewSelection } from "@/lib/checkout/selection";
import { freeDeliveryGapCents, quoteShipping } from "@/lib/shipping/rates";
import { checkoutPageSchema, parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { editorEntries, searchEditor } from "@/components/storefront/editor-search";
import { DEFAULT_CHECKOUT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductOptionGroup } from "@/types/product";
import type { SellerShippingPolicy } from "@/types/shipping-policy";

describe("selectionChips", () => {
  const groups: ProductOptionGroup[] = [
    {
      id: "g1",
      name: "Colour",
      display: "swatch",
      options: [{ id: "sage", name: "Sage", swatch: "#9caf88", available: true }],
    },
    { id: "g2", name: "Finish", display: "swatch", options: [{ id: "matte", name: "Matte", available: true }] },
    {
      id: "g3",
      name: "Size",
      display: "chip",
      // A swatch on a chip group is never drawn, as on the product page.
      options: [{ id: "small", name: " Small ", swatch: "#000000", available: true }],
    },
  ];

  it("carries the colour only where the product page draws one", () => {
    expect(selectionChips(groups, previewSelection(groups))).toEqual([
      { label: "Colour", value: "Sage", swatch: "#9caf88" },
      { label: "Finish", value: "Matte" },
      { label: "Size", value: "Small" },
    ]);
  });
});

describe("retired checkout settings still load", () => {
  it("drops a stored surface texture and reads the retired light burst as confetti", () => {
    const parsed = checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, texture: "dots", celebrate: "rays" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, celebrate: "confetti" });
  });

  it("keeps the rest of a stored checkout that carries them", () => {
    const stored = parseStoredStorefrontConfig({
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      blocks: [],
      checkoutPage: { ...DEFAULT_CHECKOUT_PAGE_CONFIG, layout: "compact", texture: "linen", celebrate: "rays" },
    });
    expect(stored?.checkoutPage).toEqual({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, layout: "compact", celebrate: "confetti" });
  });

  it("offers confetti or nothing", () => {
    expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, celebrate: "none" }).success).toBe(true);
    expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, celebrate: "fireworks" }).success).toBe(false);
  });
});

describe("freeDeliveryGapCents", () => {
  const policy: SellerShippingPolicy = {
    destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
    ratesCurrency: "EUR",
    freeOverCents: 8000,
  };
  const quote = (subtotalCents: number, from: SellerShippingPolicy = policy) =>
    quoteShipping(from, { profileId: null, country: "IE", subtotalCents, currency: "EUR" });

  it("says how far a paid delivery is from the seller's free threshold", () => {
    expect(freeDeliveryGapCents(policy, quote(2400), 2400)).toBe(5600);
  });

  it("says nothing once it is free, with no threshold, or when the quote failed", () => {
    expect(freeDeliveryGapCents(policy, quote(8000), 8000)).toBeNull();
    const noThreshold = { ...policy, freeOverCents: undefined };
    expect(freeDeliveryGapCents(noThreshold, quote(2400, noThreshold), 2400)).toBeNull();
    expect(freeDeliveryGapCents(policy, quoteShipping(policy, { profileId: null, country: "US", subtotalCents: 2400, currency: "EUR" }), 2400)).toBeNull();
    expect(freeDeliveryGapCents(policy, null, 2400)).toBeNull();
  });

  it("agrees with the quote: spending exactly the gap makes delivery free", () => {
    const gap = freeDeliveryGapCents(policy, quote(3100), 3100)!;
    expect(quote(3100 + gap)).toMatchObject({ ok: true, free: true });
    expect(quote(3100 + gap - 1)).toMatchObject({ ok: true, free: false });
  });
});

describe("the checkout's settings are findable", () => {
  const top = (query: string, checkoutOpen: boolean) =>
    searchEditor(editorEntries([], new Map(), english, { checkoutOpen }), query, english)
      .flatMap((section) => section.hits)
      .find((hit) => hit.entry.payload.kind === "setting")?.entry.title;

  it("finds the pay button and the confetti from the checkout's own settings", () => {
    expect(top("pay button", true)).toBe("Pay button");
    expect(top("confetti", true)).toBe("Thank-you celebration");
  });

  it("offers to open the checkout while it is closed", () => {
    expect(top("pay button", false)).toBe("Open the checkout");
  });
});
