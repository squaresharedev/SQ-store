// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";
import en from "../../messages/en";
import cs from "../../messages/cs";
import de from "../../messages/de";
import fr from "../../messages/fr";
import es from "../../messages/es";
import it_ from "../../messages/it";
import nl from "../../messages/nl";
import pl from "../../messages/pl";
import ptPT from "../../messages/pt-PT";
import sk from "../../messages/sk";
import {
  BADGE_PRESETS,
  canPlaceBadge,
  countRange,
  findBadgePresets,
  guessBadgeStyle,
  hasBadgeLabel,
  hasPresetBadge,
  roomForBadge,
  searchBadgePresets,
  splitKeywords,
  type LocalBadgePreset,
} from "@/lib/products/badges";
import { parseBadges, parseDetails } from "@/lib/products/detail";
import {
  badgeLabelKey,
  badgeSchema,
  badgesSchema,
  isOnPhoto,
  productDetailsSchema,
  productWriteSchema,
} from "@/lib/validation/product";
import {
  badgesSnapshot,
  badgesToInput,
  initialBadges,
  validateBadges,
  type ProductsTranslator,
} from "@/components/products/form-values";
import {
  fixFieldForPath,
  flaggedFieldsIn,
  flaggedProductSections,
} from "@/lib/moderation/fix-fields";
import {
  BADGE_COLOR_SHADES,
  BADGE_ICON_COMPONENTS,
  badgeIconColor,
} from "@/components/product-page/badge-icons";
import {
  BADGE_COLORS,
  BADGE_ICONS,
  BADGE_LABEL_MAX,
  BADGE_PLACEMENTS,
  BADGES_MAX,
  BADGES_ON_PHOTO_MAX,
} from "@/types/product";

const CATALOGUES: Record<Locale, unknown> = {
  en, cs, de, fr, es, it: it_, nl, pl, "pt-PT": ptPT, sk,
};

/** The presets as the form builds them, in one locale (useLocalBadgePresets
 *  without React). */
function localPresets(locale: Locale): LocalBadgePreset[] {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale] as typeof en,
    namespace: "Products.badges.presets",
    timeZone: "UTC",
  });
  return BADGE_PRESETS.map((preset) => {
    const count = "count" in preset ? preset.count : undefined;
    return {
      id: preset.id,
      icon: preset.icon,
      color: preset.color,
      group: preset.group,
      label: count === undefined ? t(`${preset.id}.label`) : t(`${preset.id}.label`, { count }),
      keywords: splitKeywords(t(`${preset.id}.keywords`)),
      countText: count === undefined ? null : new Intl.NumberFormat(locale).format(count),
    };
  });
}

const tEnglish = createTranslator({
  locale: "en",
  messages: en,
  namespace: "Products",
  timeZone: "UTC",
}) as unknown as ProductsTranslator;

describe("badge schema: the write boundary", () => {
  it("takes a badge with a known icon and a short label", () => {
    expect(badgeSchema.parse({ icon: "leaf", label: "  Eco friendly  " })).toEqual({
      icon: "leaf",
      label: "Eco friendly",
    });
  });

  it.each([
    ["an icon this build does not draw", { icon: "skull", label: "Spooky" }],
    ["no words", { icon: "leaf", label: "" }],
    ["only spaces", { icon: "leaf", label: "    " }],
    ["one character too many", { icon: "leaf", label: "x".repeat(BADGE_LABEL_MAX + 1) }],
    ["a line break", { icon: "leaf", label: "Eco\nfriendly" }],
    ["a control character", { icon: "leaf", label: "Eco\u0007friendly" }],
    ["a member nobody declared", { icon: "leaf", label: "Eco", href: "https://evil.test" }],
    ["a label that is not a string", { icon: "leaf", label: 42 }],
  ])("refuses %s", (_name, badge) => {
    expect(badgeSchema.safeParse(badge).success).toBe(false);
  });

  it("allows exactly the maximum length", () => {
    expect(badgeSchema.safeParse({ icon: "leaf", label: "x".repeat(BADGE_LABEL_MAX) }).success).toBe(true);
  });

  it(`caps a product at ${BADGES_MAX} badges`, () => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ icon: "star", label: `Badge ${index}` }));
    expect(badgesSchema.safeParse(make(BADGES_MAX)).success).toBe(true);
    expect(badgesSchema.safeParse(make(BADGES_MAX + 1)).success).toBe(false);
  });

  it("refuses two badges that say the same thing, however they were typed", () => {
    for (const twin of ["eco friendly", "ECO   FRIENDLY", "Éco friendly", " Eco friendly "]) {
      const parsed = badgesSchema.safeParse([
        { icon: "leaf", label: "Eco friendly" },
        { icon: "recycle", label: twin },
      ]);
      expect(parsed.success, twin).toBe(false);
    }
  });

  it("is part of the details a product write carries", () => {
    const write = productWriteSchema.safeParse({
      title: "Lamp",
      description: "",
      priceCents: 100,
      currency: "EUR",
      status: "draft",
      details: { badges: [{ icon: "hand-heart", label: "Handmade" }], materials: "Oak" },
    });
    expect(write.success).toBe(true);
    expect(productDetailsSchema.safeParse({ badges: "Handmade" }).success).toBe(false);
  });

  it("folds case, accents and spacing into one comparison key", () => {
    expect(badgeLabelKey("  Fair   TRADE ")).toBe("fair trade");
    expect(badgeLabelKey("Fairtrade")).not.toBe(badgeLabelKey("Fair trade"));
    expect(badgeLabelKey("Hecho a máno")).toBe("hecho a mano");
  });
});

describe("reading badges back: a bad one costs only itself", () => {
  const SPECS = { materials: "Oak", specs: [{ label: "Seats", value: "6" }] };

  it("keeps the specifications when one badge is malformed", () => {
    const details = parseDetails({
      ...SPECS,
      badges: [
        { icon: "leaf", label: "Eco friendly" },
        { icon: "skull", label: "Unknown icon" },
        { icon: "star" },
        "Handmade",
        { icon: "star", label: "Top rated" },
      ],
    });
    expect(details.materials).toBe("Oak");
    expect(details.specs).toEqual(SPECS.specs);
    expect(details.badges).toEqual([
      { icon: "leaf", label: "Eco friendly" },
      { icon: "star", label: "Top rated" },
    ]);
  });

  it("drops a repeat of an earlier badge's words and caps the list", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ icon: "star", label: `Badge ${index}` }));
    expect(parseBadges([{ icon: "leaf", label: "Vegan" }, { icon: "star", label: "VEGAN" }])).toEqual([
      { icon: "leaf", label: "Vegan" },
    ]);
    expect(parseBadges(many)).toHaveLength(BADGES_MAX);
  });

  it("carries no badges member at all when there are none", () => {
    expect(parseDetails(SPECS)).not.toHaveProperty("badges");
    expect(parseDetails({ ...SPECS, badges: [] })).not.toHaveProperty("badges");
    expect(parseDetails({ ...SPECS, badges: { icon: "leaf" } })).not.toHaveProperty("badges");
  });

  it("still degrades to empty when the rest of the details are broken", () => {
    const details = parseDetails({ materials: 42, badges: [{ icon: "leaf", label: "Organic" }] });
    expect(details).toEqual({ badges: [{ icon: "leaf", label: "Organic" }] });
    expect(parseDetails(null)).toEqual({});
    expect(parseDetails([1, 2])).toEqual({});
  });
});

describe("the form's badge rows", () => {
  it("round-trips stored badges with stable row keys that are never saved", () => {
    const stored = { badges: [{ icon: "leaf" as const, label: "Eco friendly" }] };
    const rows = initialBadges(stored);
    expect(rows).toEqual([
      { localId: "stored-0", icon: "leaf", label: "Eco friendly", color: "ink", placement: "beside" },
    ]);
    // The dirty check compares two copies built separately: they must match.
    expect(JSON.stringify(badgesSnapshot(initialBadges(stored)))).toBe(
      JSON.stringify(badgesSnapshot(rows)),
    );
    expect(badgesToInput(rows)).toEqual(stored.badges);
  });

  it("drops a row whose words were cleared, and trims the rest", () => {
    expect(
      badgesToInput([
        { localId: "a", icon: "leaf", label: "  Organic ", color: "ink", placement: "beside" },
        { localId: "b", icon: "star", label: "   ", color: "ink", placement: "beside" },
      ]),
    ).toEqual([{ icon: "leaf", label: "Organic" }]);
  });

  it("names two rows that say the same thing", () => {
    expect(
      validateBadges(
        [
          { localId: "a", icon: "leaf", label: "Organic", color: "ink", placement: "beside" },
          { localId: "b", icon: "sprout", label: "organic", color: "ink", placement: "beside" },
        ],
        tEnglish,
      ),
    ).toMatch(/say the same thing/);
    expect(
      validateBadges(
        [
          { localId: "a", icon: "leaf", label: "Organic", color: "ink", placement: "beside" },
          { localId: "b", icon: "sprout", label: "", color: "ink", placement: "beside" },
          { localId: "c", icon: "sprout", label: "", color: "ink", placement: "beside" },
        ],
        tEnglish,
      ),
    ).toBeUndefined();
  });
});

describe("the preset catalogue", () => {
  it("has unique ids, and every preset's icon is one the page can draw", () => {
    const ids = BADGE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of BADGE_PRESETS) {
      expect(BADGE_ICONS, preset.id).toContain(preset.icon);
    }
  });

  it("draws every icon id it stores", () => {
    expect(Object.keys(BADGE_ICON_COMPONENTS).sort()).toEqual([...BADGE_ICONS].sort());
    expect(new Set(BADGE_ICONS).size).toBe(BADGE_ICONS.length);
  });

  describe.each(LOCALES)("in %s", (locale) => {
    const presets = localPresets(locale);

    it("fits every ready-made badge within the badge limit, number and all", () => {
      for (const preset of presets) {
        expect(preset.label.trim(), preset.id).not.toBe("");
        expect(preset.label.length, `${preset.id}: ${preset.label}`).toBeLessThanOrEqual(BADGE_LABEL_MAX);
        // A preset must pass the very schema a save will put it through.
        expect(badgeSchema.safeParse({ icon: preset.icon, label: preset.label }).success, preset.id).toBe(true);
      }
    });

    it("prints each preset's number where the form can find and select it", () => {
      for (const preset of presets.filter((candidate) => candidate.countText !== null)) {
        const range = countRange(preset);
        expect(range, `${preset.id}: ${preset.label}`).not.toBeNull();
        expect(preset.label.slice(...range!)).toBe(preset.countText);
      }
    });

    it("gives every preset words to be searched by, and no two presets the same words", () => {
      for (const preset of presets) expect(preset.keywords.length, preset.id).toBeGreaterThanOrEqual(2);
      const keys = presets.map((preset) => badgeLabelKey(preset.label));
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});

describe("searching the presets", () => {
  const presets = localPresets("en");
  const ids = (query: string) => searchBadgePresets(presets, query).map((preset) => preset.id);

  it("finds a preset by its own words and by the words people search with", () => {
    expect(ids("eco")[0]).toBe("ecoFriendly");
    expect(ids("refund")).toEqual(expect.arrayContaining(["moneyBack", "freeReturns"]));
    expect(ids("plant based")[0]).toBe("vegan");
    expect(ids("dispatch")[0]).toBe("fastDispatch");
  });

  it("says whether the best preset answers every word, which is what Enter acts on", () => {
    expect(findBadgePresets(presets, "refund").complete).toBe(true);
    expect(findBadgePresets(presets, "plant based").complete).toBe(true);
    expect(findBadgePresets(presets, "Handmade in Lisbon").complete).toBe(false);
    expect(findBadgePresets(presets, "Best weed in town").complete).toBe(false);
    expect(findBadgePresets(presets, "").complete).toBe(false);
  });

  it("forgives a typo and ignores case and accents", () => {
    expect(ids("handmde")[0]).toBe("handmade");
    expect(ids("HANDMADE")[0]).toBe("handmade");
    expect(ids("végan")[0]).toBe("vegan");
  });

  it("answers nothing for an empty query or words no preset knows", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
    expect(ids("qwxzv")).toEqual([]);
  });

  it("searches in the seller's own language", () => {
    const german = localPresets("de");
    const hit = searchBadgePresets(german, german.find((preset) => preset.id === "handmade")!.label);
    expect(hit[0]?.id).toBe("handmade");
  });

  it("starts the seller's own badge with the closest preset's icon, else a plain check", () => {
    expect(guessBadgeStyle(presets, "Handmade in Lisbon")).toEqual({ icon: "hand-heart", color: "pink" });
    expect(guessBadgeStyle(presets, "qwxzv")).toEqual({ icon: "badge-check", color: "ink" });
  });

  it("counts a numbered preset as used once the seller has put their own number in it", () => {
    const lovedBy = presets.find((preset) => preset.id === "lovedBy")!;
    const handmade = presets.find((preset) => preset.id === "handmade")!;
    expect(hasPresetBadge([{ label: "Loved by 250+ people" }], lovedBy)).toBe(true);
    expect(hasPresetBadge([{ label: "Loved by 12,500+ people" }], lovedBy)).toBe(true);
    expect(hasPresetBadge([{ label: "Loved by our neighbours" }], lovedBy)).toBe(false);
    expect(hasPresetBadge([{ label: "handmade" }], handmade)).toBe(true);
    expect(hasPresetBadge([{ label: "Handmade in Lisbon" }], handmade)).toBe(false);
    // In a language that groups thousands with a space or a point.
    const german = localPresets("de").find((preset) => preset.id === "lovedBy")!;
    expect(hasPresetBadge([{ label: german.label.replace(german.countText!, "250") }], german)).toBe(true);
  });

  it("knows which words are already on the product and when it is full", () => {
    expect(hasBadgeLabel([{ label: "Eco friendly" }], "eco FRIENDLY")).toBe(true);
    expect(hasBadgeLabel([{ label: "Eco friendly" }], "")).toBe(false);
    expect(roomForBadge(BADGES_MAX - 1)).toBe(true);
    expect(roomForBadge(BADGES_MAX)).toBe(false);
  });
});

describe("a flagged badge on a paused product", () => {
  it("is the details' field, as the automatic check names its path", () => {
    expect(fixFieldForPath("product", "details.badges[].label")).toBe("specs");
    expect(fixFieldForPath("product", "details.badges[].icon")).toBe("specs");
    expect(fixFieldForPath("product", "details.safety.manufacturerName")).toBe("safety");
  });

  it("lights the Badges section as well as the Specifications", () => {
    expect(flaggedProductSections(["specs"])).toEqual(["badges", "specs"]);
    expect(flaggedFieldsIn("badges", ["specs"])).toEqual(["specs"]);
    expect(flaggedFieldsIn("specs", ["specs"])).toEqual(["specs"]);
    expect(flaggedFieldsIn("badges", ["title"])).toEqual([]);
    expect(flaggedProductSections(["title", "specs", "safety"])).toEqual([
      "basics",
      "badges",
      "specs",
      "safety",
    ]);
  });
});

describe("a badge's colour and place", () => {
  const badge = (label: string, extra: Record<string, unknown> = {}) => ({ icon: "star", label, ...extra });

  it("takes every colour and every place, and refuses ones nobody draws", () => {
    for (const color of BADGE_COLORS) {
      expect(badgeSchema.safeParse(badge("A", { color })).success, color).toBe(true);
    }
    for (const placement of BADGE_PLACEMENTS) {
      expect(badgeSchema.safeParse(badge("A", { placement })).success, placement).toBe(true);
    }
    expect(badgeSchema.safeParse(badge("A", { color: "#00ff00" })).success).toBe(false);
    expect(badgeSchema.safeParse(badge("A", { color: "chartreuse" })).success).toBe(false);
    expect(badgeSchema.safeParse(badge("A", { placement: "photo-centre" })).success).toBe(false);
  });

  it(`puts at most ${BADGES_ON_PHOTO_MAX} on the photo, in any mix of corners`, () => {
    const corners = ["photo-top-left", "photo-top-left", "photo-bottom-right", "photo-top-right"];
    const make = (count: number) =>
      corners.slice(0, count).map((placement, index) => badge(`B${index}`, { placement }));
    expect(badgesSchema.safeParse(make(BADGES_ON_PHOTO_MAX)).success).toBe(true);
    expect(badgesSchema.safeParse(make(BADGES_ON_PHOTO_MAX + 1)).success).toBe(false);
    // Any number beside the product, alongside a full photo.
    expect(
      badgesSchema.safeParse([...make(BADGES_ON_PHOTO_MAX), badge("C", { placement: "beside" }), badge("D")]).success,
    ).toBe(true);
  });

  it("reads back a colour or place this build does not know as the default, keeping the badge", () => {
    expect(
      parseBadges([
        badge("Mystery colour", { color: "ultraviolet" }),
        badge("Mystery place", { placement: "photo-centre", color: "green" }),
        badge("Plain ink", { color: "ink", placement: "beside" }),
      ]),
    ).toEqual([
      { icon: "star", label: "Mystery colour" },
      { icon: "star", label: "Mystery place", color: "green" },
      { icon: "star", label: "Plain ink" },
    ]);
  });

  it("moves anything past the photo's cap beside the product when reading a stored row", () => {
    const stored = ["A", "B", "C", "D", "E"].map((label) => badge(label, { placement: "photo-bottom-left" }));
    const read = parseBadges(stored);
    expect(read.filter(isOnPhoto).map((b) => b.label)).toEqual(["A", "B", "C"]);
    expect(read.filter((b) => !isOnPhoto(b)).map((b) => b.label)).toEqual(["D", "E"]);
    expect(badgesSchema.safeParse(read).success).toBe(true);
  });

  it("round-trips through the form, storing a colour and place only when not the default", () => {
    const stored = {
      badges: [
        { icon: "leaf" as const, label: "Eco friendly", color: "green" as const, placement: "photo-top-right" as const },
        { icon: "star" as const, label: "Top rated" },
      ],
    };
    const rows = initialBadges(stored);
    expect(rows.map(({ color, placement }) => [color, placement])).toEqual([
      ["green", "photo-top-right"],
      ["ink", "beside"],
    ]);
    expect(badgesToInput(rows)).toEqual(stored.badges);
    expect(badgesSnapshot(rows)).toEqual(stored.badges);
  });

  it("names a photo holding more than it may", () => {
    const rows = ["A", "B", "C", "D"].map((label) => ({
      localId: label,
      icon: "star" as const,
      label,
      color: "ink" as const,
      placement: "photo-top-left" as const,
    }));
    expect(validateBadges(rows, tEnglish)).toBe(
      `Only ${BADGES_ON_PHOTO_MAX} badges fit on the photo. Move one beside the product.`,
    );
    expect(validateBadges(rows.slice(0, BADGES_ON_PHOTO_MAX), tEnglish)).toBeUndefined();
  });

  it("lets a badge move between corners on a full photo, but not join it", () => {
    const full = [
      { placement: "photo-top-left" as const },
      { placement: "photo-top-right" as const },
      { placement: "photo-bottom-left" as const },
      { placement: "beside" as const },
    ];
    const [onPhoto, , , outside] = full;
    expect(canPlaceBadge(full, onPhoto!, "photo-bottom-right")).toBe(true);
    expect(canPlaceBadge(full, onPhoto!, "beside")).toBe(true);
    expect(canPlaceBadge(full, outside!, "photo-bottom-right")).toBe(false);
    expect(canPlaceBadge(full, outside!, "beside")).toBe(true);
    expect(canPlaceBadge(full.slice(1), outside!, "photo-bottom-right")).toBe(true);
  });

  it("gives every preset a colour the page can draw, and a reason for it", () => {
    for (const preset of BADGE_PRESETS) expect(BADGE_COLORS, preset.id).toContain(preset.color);
    const colorOf = (id: string) => BADGE_PRESETS.find((preset) => preset.id === id)!.color;
    expect(colorOf("ecoFriendly")).toBe("green");
    expect(colorOf("lovedBy")).toBe("red");
    expect(colorOf("freeShipping")).toBe("blue");
  });

  it("draws a coloured icon in a darker shade on a light page and a lighter one on a dark page", () => {
    expect(badgeIconColor("green", "#171717")).toBe(BADGE_COLOR_SHADES.green.onLight);
    expect(badgeIconColor("green", "#ffffff")).toBe(BADGE_COLOR_SHADES.green.onDark);
    expect(badgeIconColor("ink", "#ffffff")).toBe("#ffffff");
    expect(badgeIconColor(undefined, "#171717")).toBe("#171717");
    expect(Object.keys(BADGE_COLOR_SHADES).sort()).toEqual(BADGE_COLORS.filter((c) => c !== "ink").sort());
  });

  it("keeps every shade distinguishable on its own background (3:1 for a graphic, WCAG 1.4.11)", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((at) => {
        const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    for (const [name, shades] of Object.entries(BADGE_COLOR_SHADES)) {
      expect(contrast(shades.onLight, "#ffffff"), `${name} on white`).toBeGreaterThanOrEqual(3);
      expect(contrast(shades.onDark, "#171717"), `${name} on near-black`).toBeGreaterThanOrEqual(3);
    }
  });
});
