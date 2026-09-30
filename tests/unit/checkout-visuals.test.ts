/**
 * The checkout's visual pass: the texture presets (stored as a closed token,
 * drawn by one module, findable from the editor's search), the version drawn
 * as chips with real swatches, and the free-delivery nudge that must never
 * promise a price the quote would not give.
 */
import { describe, expect, it } from "vitest";
import { english } from "../setup/translate";
import { selectionChips, previewSelection } from "@/lib/checkout/selection";
import { freeDeliveryGapCents, quoteShipping } from "@/lib/shipping/rates";
import { checkoutPageSchema, parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { isDefaultCheckoutPage } from "@/lib/storefront/checkout-page";
import { TEXTURE_SWATCH_LOOK, textureLayers } from "@/components/checkout/checkout-textures";
import { resolveCheckoutTheme } from "@/components/checkout/checkout-theme";
import { DARK_INK, LIGHT_INK } from "@/components/product-page/product-page-maps";
import { editorEntries, searchEditor } from "@/components/storefront/editor-search";
import {
  CHECKOUT_TEXTURES,
  DEFAULT_CHECKOUT_PAGE_CONFIG,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
} from "@/types/storefront";
import type { ProductOptionGroup } from "@/types/product";
import type { SellerShippingPolicy } from "@/types/shipping-policy";

describe("checkout texture as stored", () => {
  it("accepts every preset by name, and absent is a plain page", () => {
    for (const texture of CHECKOUT_TEXTURES) {
      expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, texture }).success, texture).toBe(true);
    }
    expect(checkoutPageSchema.safeParse(DEFAULT_CHECKOUT_PAGE_CONFIG).success).toBe(true);
  });

  it("refuses anything that is not a preset name, CSS included", () => {
    for (const texture of ["none", "plain", "url(x)", "repeating-linear-gradient(red, blue)", "", 3]) {
      expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, texture }).success).toBe(false);
    }
  });

  it("keeps a checkout saved before textures existed, and a textured one is not the default", () => {
    const stored = parseStoredStorefrontConfig({
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      blocks: [],
      checkoutPage: { ...DEFAULT_CHECKOUT_PAGE_CONFIG, layout: "compact" },
    });
    expect(stored?.checkoutPage).toEqual({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, layout: "compact" });
    expect(isDefaultCheckoutPage({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, texture: "dots" })).toBe(false);
  });
});

describe("textureLayers", () => {
  it("draws nothing for a plain page", () => {
    expect(textureLayers(undefined, DARK_INK)).toEqual({});
  });

  it("draws every preset in the page's own ink, and only as code-made CSS", () => {
    for (const texture of CHECKOUT_TEXTURES) {
      const dark = textureLayers(texture, DARK_INK);
      const light = textureLayers(texture, LIGHT_INK);
      expect(dark.backgroundImage, texture).toBeTruthy();
      expect(dark.backgroundImage).not.toEqual(light.backgroundImage);
      // The only url() any preset makes is its own inline SVG.
      const urls = String(dark.backgroundImage).match(/url\("([^"]*)"\)/g) ?? [];
      for (const url of urls) expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    }
    expect(String(textureLayers("dots", DARK_INK).backgroundImage)).toContain("rgba(23,23,23,");
    expect(String(textureLayers("dots", LIGHT_INK).backgroundImage)).toContain("rgba(255,255,255,");
  });

  it("draws a swatch stronger than the page, so a 40px tile shows the pattern", () => {
    const alpha = (css: unknown) => Number(/rgba\(\d+,\d+,\d+,([\d.]+)\)/.exec(String(css))?.[1]);
    expect(alpha(textureLayers("grid", DARK_INK, TEXTURE_SWATCH_LOOK).backgroundImage)).toBeGreaterThan(
      alpha(textureLayers("grid", DARK_INK).backgroundImage),
    );
    expect(textureLayers("grid", DARK_INK, TEXTURE_SWATCH_LOOK).backgroundSize).toBe("12px 12px");
  });

  it("reaches the checkout's theme, over the surface and never instead of it", () => {
    const storefront = {
      id: "s",
      name: "Clay House",
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
      checkoutPage: { ...DEFAULT_CHECKOUT_PAGE_CONFIG, backgroundColor: "#1f2a24", texture: "linen" as const },
      shippingPolicy: {},
      seller: {},
      backgroundImageUrl: null,
      customFontUrl: null,
    };
    const theme = resolveCheckoutTheme(storefront);
    expect(theme.surface).toBe("#1f2a24");
    expect(theme.surfaceTexture).toEqual(textureLayers("linen", LIGHT_INK));
    expect(theme.surfaceTexture).not.toHaveProperty("backgroundColor");
    expect(resolveCheckoutTheme({ ...storefront, checkoutPage: DEFAULT_CHECKOUT_PAGE_CONFIG }).surfaceTexture).toEqual({});
  });
});

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

  it("gives a colour only where the product page would draw one", () => {
    expect(selectionChips(groups, previewSelection(groups))).toEqual([
      { label: "Colour", value: "Sage", swatch: "#9caf88" },
      { label: "Finish", value: "Matte" },
      { label: "Size", value: "Small" },
    ]);
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

describe("the checkout's new settings are findable", () => {
  const top = (query: string, checkoutOpen: boolean) =>
    searchEditor(editorEntries([], new Map(), english, { checkoutOpen }), query, english)
      .flatMap((section) => section.hits)
      .find((hit) => hit.entry.payload.kind === "setting")?.entry.title;

  it("finds the texture by what a seller would call one", () => {
    for (const query of ["texture", "checkout pattern", "graph paper", "polka dots", "linen"]) {
      expect(top(query, true), query).toBe("Checkout texture");
    }
  });

  it("finds the pay button from the checkout's own settings", () => {
    expect(top("pay button", true)).toBe("Pay button");
  });

  it("offers to open the checkout for either while it is closed", () => {
    expect(top("texture", false)).toBe("Open the checkout");
    expect(top("pay button", false)).toBe("Open the checkout");
  });
});
