import { describe, expect, it } from "vitest";
import {
  CONTROLS_GROUPS,
  GROUP_LABELS,
  PRODUCT_PAGE_HOTSPOTS,
  SECTION_SETTING,
  STOREFRONT_SETTINGS,
  freshSettingRef,
  isPerTileSetting,
  isProductPageHotspot,
  isSameSettingRef,
  settingById,
  settingGroup,
  settingIndexFields,
} from "@/lib/storefront/setting-ref";
import { resolveInk } from "@/components/product-page/product-page-maps";
import { collectStorefrontColors } from "@/lib/theme/palette";
import {
  DEFAULT_STOREFRONT_CONFIG,
  PRODUCT_PAGE_SECTION_IDS,
} from "@/types/storefront";

describe("product page settings catalogue", () => {
  it("registers the group and labels it", () => {
    expect(CONTROLS_GROUPS).toContain("productPage");
    expect(GROUP_LABELS.productPage).toBe("Product page");
  });

  it("lists five sections, each findable by id and filed under the group", () => {
    const ids = ["product-page-layout", "buy-button", "product-page-sections", "shipping-returns", "seller-details"];
    for (const id of ids) {
      const entry = settingById(id);
      expect(entry, id).not.toBeNull();
      expect(settingGroup(entry!.ref)).toBe("productPage");
      expect(isPerTileSetting(entry!.ref)).toBe(false);
      expect(settingIndexFields(entry!).subtitle).toBe("Storefront / Product page");
    }
    expect(STOREFRONT_SETTINGS.filter((s) => s.ref.kind === "productPage")).toHaveLength(5);
  });

  it("compares product page refs by section", () => {
    expect(
      isSameSettingRef(
        { kind: "productPage", section: "seller" },
        { kind: "productPage", section: "seller" },
      ),
    ).toBe(true);
    expect(
      isSameSettingRef(
        { kind: "productPage", section: "seller" },
        { kind: "productPage", section: "cta" },
      ),
    ).toBe(false);
    expect(
      isSameSettingRef({ kind: "productPage", section: "cta" }, { kind: "cards", section: "priceTag" }),
    ).toBe(false);
  });

  it("finds seller details for the words a seller would use", () => {
    const entry = settingById("seller-details")!;
    expect(entry.keywords).toEqual(expect.arrayContaining(["vat id", "imprint", "contact email"]));
  });

  it("clones a ref so a repeat open of the SAME hotspot is never a no-op", () => {
    // PRODUCT_PAGE_HOTSPOTS and STOREFRONT_SETTINGS are module-level
    // constants: every click on the same hotspot hands back the identical
    // object. Feeding that straight to useState would make a second click
    // indistinguishable from the first at the React level (Object.is bails
    // out), which would swallow a seller's click if they had navigated the
    // panel elsewhere by hand in between. Cloning defeats that, while
    // isSameSettingRef (which compares by value, deliberately) still calls
    // it the same setting.
    const ref = PRODUCT_PAGE_HOTSPOTS.cta;
    const clone = freshSettingRef(ref);
    expect(clone).not.toBe(ref);
    expect(clone).toEqual(ref);
    expect(isSameSettingRef(clone, ref)).toBe(true);
  });
});

describe("product page hotspots", () => {
  it("every hotspot resolves to a real setting the panel can open", () => {
    for (const [name, ref] of Object.entries(PRODUCT_PAGE_HOTSPOTS)) {
      expect(isProductPageHotspot(name), name).toBe(true);
      // A group the panel actually has, so a click can never aim at nothing.
      expect(CONTROLS_GROUPS, name).toContain(settingGroup(ref));
    }
    // Two deliberately leave the Product page group: the store's name bar and
    // the page's backdrop are storefront-wide settings, and sending a seller
    // to the group that owns them beats opening a section that cannot change
    // what they clicked.
    expect(settingGroup(PRODUCT_PAGE_HOTSPOTS.header)).toBe("header");
    expect(settingGroup(PRODUCT_PAGE_HOTSPOTS.background)).toBe("theme");
  });

  it("rejects a name that is not a hotspot", () => {
    for (const bogus of ["", "Sections", "gallery", "__proto__", "toString"]) {
      expect(isProductPageHotspot(bogus), bogus).toBe(false);
    }
  });

  it("routes every page section to a hotspot, policies and seller to their own", () => {
    for (const id of PRODUCT_PAGE_SECTION_IDS) {
      expect(isProductPageHotspot(SECTION_SETTING[id]), id).toBe(true);
    }
    // The words live in the policy and seller panels, not in the list that
    // only toggles the sections, so those three lead where the text is.
    expect(SECTION_SETTING.shipping).toBe("policies");
    expect(SECTION_SETTING.returns).toBe("policies");
    expect(SECTION_SETTING.seller).toBe("seller");
    expect(SECTION_SETTING.specs).toBe("sections");
  });
});

describe("product page ink", () => {
  const theme = DEFAULT_STOREFRONT_CONFIG.theme;

  it("is derived from the background, with no colour left to pick", () => {
    // The page's ink used to be a colour target the seller could open. It is
    // derived now, so there is no ref for it and nothing to resolve: the only
    // question was which of two inks is legible, and lightness answers that.
    expect(resolveInk(theme)).toBe("#171717"); // white background: dark ink
    expect(resolveInk({ ...theme, background: { kind: "solid", color: "#101010" } })).toBe(
      "#ffffff",
    );
    // An image background gets light ink, the usual choice over a photo.
    expect(
      resolveInk({
        ...theme,
        background: { kind: "image", key: "images/x/y-z.jpg", x: 50, y: 50, scale: 100 },
      }),
    ).toBe("#ffffff");
  });

  it("contributes nothing to the design's palette", () => {
    // Nothing on the product page holds a colour of its own any more, so the
    // palette is exactly what the theme and the blocks wear.
    expect(collectStorefrontColors(theme, [], undefined)).toEqual(
      collectStorefrontColors(theme, []),
    );
  });
});
