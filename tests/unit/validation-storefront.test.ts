import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS,
  embedSettingsSchema,
  isStrictHexColor,
  parseStoredStorefrontConfig,
  storefrontConfigSchema,
  storefrontIdSchema,
  storefrontNameSchema,
} from "@/lib/validation/storefront";
import {
  DEFAULT_STOREFRONT_CONFIG,
  EMBED_MAX_DOMAINS,
  IMAGE_ALT_MAX,
  TEXT_MAX_LENGTH,
  type StorefrontConfig,
} from "@/types/storefront";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UUID2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function validConfig(): StorefrontConfig {
  return structuredClone({
    ...DEFAULT_STOREFRONT_CONFIG,
    blocks: [
      { type: "product", productId: UUID, x: 0, y: 0, w: 2, h: 2 },
      {
        type: "text",
        id: UUID2,
        text: "hello\nworld",
        variant: "heading",
        align: "left",
        x: 2,
        y: 0,
        w: 2,
        h: 1,
      },
    ],
  } as StorefrontConfig);
}

describe("storefrontConfigSchema — happy path", () => {
  it("accepts the default config", () => {
    expect(storefrontConfigSchema.safeParse(DEFAULT_STOREFRONT_CONFIG).success).toBe(true);
  });

  it("accepts a mixed-block config", () => {
    expect(storefrontConfigSchema.safeParse(validConfig()).success).toBe(true);
  });

  it("accepts text-block style overrides and rejects hostile variants", () => {
    const config = validConfig();
    const textBlock = config.blocks[1] as Record<string, unknown>;
    textBlock.color = "#ff0000";
    textBlock.fontSize = "xl";
    textBlock.font = "mono";
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);

    // Non-strict color, off-list size/font must all fail.
    for (const patch of [
      { color: "red" },
      { color: "#fff" },
      { fontSize: "97px" },
      { font: "comic-sans" },
    ]) {
      const bad = validConfig();
      Object.assign(bad.blocks[1] as Record<string, unknown>, patch);
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts every price tag appearance field and rejects off-list values", () => {
    const config = validConfig();
    Object.assign(config.theme, {
      priceTagPosition: "bottom-right",
      priceTagFont: "mono",
      priceTagSize: 14,
      priceTagColor: "#fbbf24",
      priceTagTextColor: "#1c1917",
      priceTagBorderColor: "#d97706",
      priceTagBorderWidth: 1,
      priceTagRadius: 4,
    });
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);

    // Configs saved before any of these existed (absent keys) still parse.
    const legacy = validConfig();
    delete legacy.theme.priceTagSize;
    expect(storefrontConfigSchema.safeParse(legacy).success).toBe(true);

    for (const patch of [
      { priceTagPosition: "center" },
      // Bounds, both ends, and non-integers.
      { priceTagSize: 7 },
      { priceTagSize: 33 },
      { priceTagSize: 12.5 },
      // NB not "lg": the theme preprocess migrates the retired enum to px, so
      // a legacy value parses rather than failing (see the migration tests).
      { priceTagSize: "huge" },
      { priceTagBorderWidth: -1 },
      { priceTagBorderWidth: 9 },
      { priceTagRadius: 25 },
      // A face that exists in STOREFRONT_FONTS but not on the tag's own list.
      { priceTagFont: "display" },
      { priceTagFont: "custom" },
      // Colors are strict 6-digit hex, like every other color in the config.
      { priceTagColor: "red" },
      { priceTagTextColor: "#fff" },
      { priceTagBorderColor: "rgba(0,0,0,.5)" },
    ]) {
      const bad = validConfig();
      Object.assign(bad.theme as Record<string, unknown>, patch);
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts per-tile card style overrides and rejects hostile variants", () => {
    const config = validConfig();
    const productBlock = config.blocks[0] as Record<string, unknown>;
    productBlock.style = {
      cornerRadius: 100,
      showTitle: false,
      titleStyle: "overlay",
      titleDisplay: "hover",
      priceDisplay: "hover",
      priceTagPosition: "top-center",
      priceTagFont: "serif",
      priceTagSize: 14,
      priceTagColor: "#fbbf24",
      priceTagTextColor: "#1c1917",
      priceTagBorderColor: "#d97706",
      priceTagBorderWidth: 2,
      priceTagRadius: 24,
    };
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);

    // A partial override (only what the seller changed) parses too.
    const partial = validConfig();
    (partial.blocks[0] as Record<string, unknown>).style = { cornerRadius: 50 };
    expect(storefrontConfigSchema.safeParse(partial).success).toBe(true);

    // Off-list enums, out-of-range ints, and unknown keys must all fail.
    for (const style of [
      { cornerRadius: 101 },
      { cornerRadius: -1 },
      { cornerRadius: 12.5 },
      { titleStyle: "neon" },
      { priceTagPosition: "everywhere" },
      { priceTagSize: 33 },
      { priceTagFont: "display" },
      { priceTagRadius: -1 },
      { priceTagColor: "red" },
      { background: "#ff0000" },
      { className: "hacked" },
    ]) {
      const bad = validConfig();
      (bad.blocks[0] as Record<string, unknown>).style = style;
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }

    // Style on a non-product block is rejected (only product tiles carry it).
    const wrongKind = validConfig();
    (wrongKind.blocks[1] as Record<string, unknown>).style = { cornerRadius: 4 };
    expect(storefrontConfigSchema.safeParse(wrongKind).success).toBe(false);
  });

  it("accepts shape geometry params and rejects out-of-range values", () => {
    const config = validConfig();
    config.blocks.push({
      type: "shape",
      id: "cccccccc-dddd-4eee-8fff-000000000000",
      kind: "star",
      color: "#171717",
      x: 4,
      y: 0,
      w: 1,
      h: 1,
      roundness: 20,
      points: 8,
    });
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);

    for (const patch of [
      { roundness: 51 },
      { roundness: -1 },
      { roundness: 10.5 },
      { points: 2 },
      { points: 13 },
      { points: "5" },
    ]) {
      const bad = structuredClone(config);
      Object.assign(bad.blocks[2] as Record<string, unknown>, patch);
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts configs without optional header/embed (older saves)", () => {
    const cfg = validConfig();
    delete cfg.header;
    delete cfg.embed;
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(true);
  });
});

describe("storefrontConfigSchema — hostile input", () => {
  it("rejects unknown keys at every level (jsonb smuggling)", () => {
    const cfg = validConfig() as Record<string, unknown>;
    cfg.evil = "payload";
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);

    const cfg2 = validConfig();
    (cfg2.theme as Record<string, unknown>).xss = "<script>";
    expect(storefrontConfigSchema.safeParse(cfg2).success).toBe(false);

    const cfg3 = validConfig();
    (cfg3.blocks[0] as Record<string, unknown>).onclick = "alert(1)";
    expect(storefrontConfigSchema.safeParse(cfg3).success).toBe(false);
  });

  it("rejects every non-strict color form (CSS injection guard)", () => {
    for (const color of [
      "red",
      "#fff",
      "#ffff",
      "#fffffff",
      "rgb(0,0,0)",
      "rgba(0,0,0,1)",
      "url(javascript:alert(1))",
      "#ffffff; background:url(x)",
      "expression(alert(1))",
      " #ffffff",
      "#ffffff ",
    ]) {
      const cfg = validConfig();
      cfg.theme.accent = color;
      expect(storefrontConfigSchema.safeParse(cfg).success, color).toBe(false);
      expect(isStrictHexColor(color)).toBe(false);
    }
  });

  it("rejects a gradient with an out-of-range angle or non-integer angle", () => {
    for (const angle of [-1, 361, 45.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cfg = validConfig();
      cfg.theme.background = { kind: "gradient", from: "#000000", to: "#ffffff", angle };
      expect(storefrontConfigSchema.safeParse(cfg).success, String(angle)).toBe(false);
    }
  });

  it("drops pattern backgrounds to their base color, discarding the preset", () => {
    // Patterns were removed. The migration keeps the stored base color and
    // throws the preset away, so a hostile preset string can never survive
    // the parse in any form.
    const cfg = validConfig();
    cfg.theme.background = {
      kind: "pattern",
      preset: "url(evil)",
      color: "#ffffff",
    } as unknown as StorefrontConfig["theme"]["background"];
    const parsed = storefrontConfigSchema.safeParse(cfg);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.theme.background).toEqual({ kind: "solid", color: "#ffffff" });
  });

  it("falls back to white when a pattern background carries no usable color", () => {
    const cfg = validConfig();
    cfg.theme.background = {
      kind: "pattern",
      preset: "dots",
    } as unknown as StorefrontConfig["theme"]["background"];
    const parsed = storefrontConfigSchema.safeParse(cfg);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.theme.background).toEqual({ kind: "solid", color: "#ffffff" });
  });

  it("rejects a raw CSS string as background (v1 strings only pass through the upgrader)", () => {
    const cfg = validConfig();
    (cfg.theme as Record<string, unknown>).background = "linear-gradient(red, blue)";
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects control characters in text blocks; allows newline", () => {
    const base = validConfig();

    // Built via fromCharCode so no raw control bytes live in this file:
    // NUL, unit separator (0x1f), DEL (0x7f), carriage return, tab.
    const hostile = [0, 0x1f, 0x7f, 0x0d, 0x09].map(
      (code) => "a" + String.fromCharCode(code) + "b",
    );
    for (const text of hostile) {
      const cfg = structuredClone(base);
      (cfg.blocks[1] as { text: string }).text = text;
      expect(storefrontConfigSchema.safeParse(cfg).success, JSON.stringify(text)).toBe(false);
    }

    const okCfg = structuredClone(base);
    (okCfg.blocks[1] as { text: string }).text = "line1" + String.fromCharCode(10) + "line2";
    expect(storefrontConfigSchema.safeParse(okCfg).success).toBe(true);
  });

  it("caps text length", () => {
    const cfg = validConfig();
    (cfg.blocks[1] as { text: string }).text = "x".repeat(TEXT_MAX_LENGTH + 1);
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects header name with newline (single-line field) but allows it in bio", () => {
    const cfg = validConfig();
    cfg.header = { show: true, name: "two\nlines", bio: "" };
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);

    const cfg2 = validConfig();
    cfg2.header = { show: true, name: "one line", bio: "two\nlines ok" };
    expect(storefrontConfigSchema.safeParse(cfg2).success).toBe(true);
  });

  it("accepts header colors and rejects non-strict hex", () => {
    const cfg = validConfig();
    cfg.header = {
      show: true,
      name: "Shop",
      bio: "Hello",
      nameColor: "#ff0000",
      bioColor: "#00ff00",
    };
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(true);

    // Absent colors (every header saved before this) still parse.
    const legacy = validConfig();
    legacy.header = { show: true, name: "Shop", bio: "Hello" };
    expect(storefrontConfigSchema.safeParse(legacy).success).toBe(true);

    for (const patch of [
      { nameColor: "red" },
      { nameColor: "#fff" },
      { bioColor: "rgb(0,0,0)" },
      { bioColor: "#00ff00; background:url(x)" },
    ]) {
      const bad = validConfig();
      bad.header = { show: true, name: "Shop", bio: "Hi", ...patch };
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts header sizes in px and rejects anything off the scale", () => {
    const cfg = validConfig();
    cfg.header = {
      show: true,
      name: "Shop",
      bio: "Hello",
      nameSize: 96,
      bioSize: 8,
    };
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(true);

    for (const patch of [
      { nameSize: 7 },
      { nameSize: 201 },
      { bioSize: 16.5 },
      { bioSize: "24px" },
    ] as Record<string, unknown>[]) {
      const bad = validConfig();
      bad.header = { show: true, name: "Shop", bio: "Hi", ...patch } as never;
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("takes free-form text sizes in px and migrates the old presets", () => {
    for (const size of [8, 16, 97, 200]) {
      const cfg = validConfig();
      (cfg.blocks[1] as Record<string, unknown>).fontSize = size;
      expect(storefrontConfigSchema.safeParse(cfg).success).toBe(true);
    }

    // The five old presets become the px they used to render at, so a
    // storefront saved before free-form sizing is unchanged to the eye.
    const legacy = validConfig();
    (legacy.blocks[1] as Record<string, unknown>).fontSize = "2xl";
    const parsed = storefrontConfigSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(
      (parsed.data!.blocks[1] as { fontSize?: number }).fontSize,
    ).toBe(36);

    // Out of range, fractional, and non-numeric are all still refused.
    for (const size of [7, 201, 16.5, "97px", "huge", null]) {
      const bad = validConfig();
      (bad.blocks[1] as Record<string, unknown>).fontSize = size;
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts an uploaded theme font by key and rejects anything else", () => {
    const owner = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const key = `fonts/${owner}/11111111-2222-4333-8444-555555555555-f.woff2`;
    const cfg = validConfig();
    cfg.theme.font = "custom";
    cfg.theme.customFont = { key, name: "f.woff2" };
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(true);

    // Never a URL, never someone else's prefix, never a free-form path — and
    // never an unknown member riding along inside it.
    for (const customFont of [
      { key: "https://evil.example/f.woff2", name: "f" },
      { key: `images/${owner}/11111111-2222-4333-8444-555555555555-f.png`, name: "f" },
      { key: "fonts/../secret", name: "f" },
      { key, name: "x".repeat(61) },
      { key, name: "f", src: "url(evil)" },
      { key },
    ]) {
      const bad = validConfig();
      bad.theme.customFont = customFont as never;
      expect(storefrontConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts the new preset fonts on the theme and on a block", () => {
    for (const font of ["inter", "montserrat"] as const) {
      const cfg = validConfig();
      cfg.theme.font = font;
      (cfg.blocks[1] as Record<string, unknown>).font = font;
      expect(storefrontConfigSchema.safeParse(cfg).success).toBe(true);
    }
  });

  it("rejects more than MAX_BLOCKS blocks", () => {
    const cfg = validConfig();
    cfg.blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({
      type: "shape" as const,
      id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
      kind: "square" as const,
      color: "#000000",
      x: i % 6,
      y: Math.floor(i / 6),
      w: 1,
      h: 1,
    }));
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects duplicate blocks (same product twice / same shape id twice)", () => {
    const cfg = validConfig();
    cfg.blocks = [
      { type: "product", productId: UUID, x: 0, y: 0, w: 1, h: 1 },
      { type: "product", productId: UUID, x: 1, y: 0, w: 2, h: 2 },
    ];
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects out-of-range, fractional, or zero-span placements", () => {
    const bad = [
      { x: -1 },
      { y: -1 },
      { w: 0 },
      { h: 0 },
      { x: 1.5 },
      { w: 2.5 },
      { x: 10_000 },
      { h: 10_000 },
    ];
    for (const patch of bad) {
      const cfg = validConfig();
      Object.assign(cfg.blocks[0], patch);
      expect(storefrontConfigSchema.safeParse(cfg).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("rejects blocks that overlap each other", () => {
    const cfg = validConfig();
    // The text block is at x:2; drop it straight onto the product block.
    Object.assign(cfg.blocks[1], { x: 0, y: 0, w: 2, h: 2 });
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects a non-uuid productId", () => {
    const cfg = validConfig();
    (cfg.blocks[0] as { productId: string }).productId = "1 OR 1=1";
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });
});

describe("embedSettingsSchema", () => {
  it("accepts bare lowercase hostnames", () => {
    expect(
      embedSettingsSchema.safeParse({ enabled: true, domains: ["yoursite.com", "shop.my-site.co.uk"] }).success,
    ).toBe(true);
  });

  it("rejects protocols, paths, ports, wildcards, uppercase, unicode", () => {
    for (const domain of [
      "https://yoursite.com",
      "yoursite.com/path",
      "yoursite.com:8080",
      "*.yoursite.com",
      "YourSite.com",
      "localhost",
      "yoursite",
      "-bad.com",
      "bad-.com",
      "xn--", // malformed
      "a.b", // too short (min 4 chars total)
      "évil.com",
      "javascript:alert(1)",
      "site.com evil.com",
    ]) {
      const r = embedSettingsSchema.safeParse({ enabled: true, domains: [domain] });
      expect(r.success, domain).toBe(false);
    }
  });

  it("caps the domain list and rejects duplicates", () => {
    const many = Array.from({ length: EMBED_MAX_DOMAINS + 1 }, (_, i) => `site${i}.com`);
    expect(embedSettingsSchema.safeParse({ enabled: true, domains: many }).success).toBe(false);
    expect(
      embedSettingsSchema.safeParse({ enabled: true, domains: ["dup.com", "dup.com"] }).success,
    ).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(
      embedSettingsSchema.safeParse({ enabled: true, domains: [], extra: 1 }).success,
    ).toBe(false);
  });
});

describe("id + name schemas", () => {
  it("storefrontIdSchema takes uuids only", () => {
    expect(storefrontIdSchema.safeParse(UUID).success).toBe(true);
    expect(storefrontIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(storefrontIdSchema.safeParse("' OR 1=1 --").success).toBe(false);
  });

  it("storefrontNameSchema trims and bounds 1..80", () => {
    expect(storefrontNameSchema.safeParse("  My store  ").data).toBe("My store");
    expect(storefrontNameSchema.safeParse("").success).toBe(false);
    expect(storefrontNameSchema.safeParse("   ").success).toBe(false);
    expect(storefrontNameSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(storefrontNameSchema.safeParse("x".repeat(80)).success).toBe(true);
  });
});

describe("parseStoredStorefrontConfig — v1 upgrades", () => {
  it("passes a current config through unchanged", () => {
    const cfg = validConfig();
    expect(parseStoredStorefrontConfig(cfg)).toEqual(cfg);
  });

  it("upgrades v1 blocks without a type to product blocks", () => {
    const stored = {
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme },
      blocks: [{ productId: UUID, size: "2x2", order: 0 }],
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed).not.toBeNull();
    expect(parsed!.blocks[0]).toMatchObject({ type: "product", productId: UUID });
  });

  it("upgrades a bare hex background string to a solid", () => {
    const stored = {
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, background: "#123456" },
      blocks: [],
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed!.theme.background).toEqual({ kind: "solid", color: "#123456" });
  });

  it("upgrades legacy named backgrounds to their gradient", () => {
    const stored = {
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, background: "linen" },
      blocks: [],
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed!.theme.background).toMatchObject({ kind: "gradient" });
  });

  it("unknown legacy background falls back to the default, never a raw string", () => {
    const stored = {
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, background: "linear-gradient(red,blue)" },
      blocks: [],
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed!.theme.background).toEqual(DEFAULT_STOREFRONT_CONFIG.theme.background);
  });

  it("fills missing v1 theme fields from defaults", () => {
    const stored = {
      theme: { background: "#ffffff", accent: "#000000", font: "sans", radius: "none" },
      blocks: [],
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed).not.toBeNull();
    // cardStyle was split into titleStyle + titleDisplay, and the legacy
    // `radius` enum folded into the numeric cornerRadius.
    expect(parsed!.theme.titleStyle).toBe(DEFAULT_STOREFRONT_CONFIG.theme.titleStyle);
    expect(parsed!.theme.titleDisplay).toBe(DEFAULT_STOREFRONT_CONFIG.theme.titleDisplay);
    expect(parsed!.theme.cornerRadius).toBe(0);
  });

  it("migrates legacy price tag positions and drops the short-lived corner key", () => {
    for (const [legacy, expected] of [
      ["onImage", "bottom-left"],
      ["corner", "top-right"],
    ] as const) {
      const stored = {
        ...validConfig(),
        theme: {
          ...validConfig().theme,
          priceTagPosition: legacy,
          priceTagCorner: "bottomRight",
        },
      };
      const parsed = parseStoredStorefrontConfig(stored);
      expect(parsed, legacy).not.toBeNull();
      expect(parsed!.theme.priceTagPosition, legacy).toBe(expected);
      expect(parsed!.theme).not.toHaveProperty("priceTagCorner");
    }
  });

  it("migrates the retired plain/pill style into radius + border width", () => {
    for (const [style, radius, borderWidth] of [
      ["pill", 24, 1],
      ["plain", 2, undefined],
    ] as const) {
      const parsed = parseStoredStorefrontConfig({
        ...validConfig(),
        theme: { ...validConfig().theme, priceTagStyle: style },
      });
      expect(parsed, style).not.toBeNull();
      expect(parsed!.theme.priceTagRadius, style).toBe(radius);
      expect(parsed!.theme.priceTagBorderWidth, style).toBe(borderWidth);
      // The retired key must be gone: strictObject would reject it on re-save.
      expect(parsed!.theme).not.toHaveProperty("priceTagStyle");
    }
  });

  it("migrates the retired sm/md/lg chip size to the px each one rendered at", () => {
    for (const [legacy, px] of [
      ["sm", 10],
      ["md", 12],
      ["lg", 14],
    ] as const) {
      const parsed = parseStoredStorefrontConfig({
        ...validConfig(),
        theme: { ...validConfig().theme, priceTagSize: legacy },
      });
      expect(parsed, legacy).not.toBeNull();
      expect(parsed!.theme.priceTagSize, legacy).toBe(px);
    }
  });

  it("migrates the retired presets on a per-tile override too", () => {
    // A tile that overrode plain/pill or sm/md/lg carries the same two keys,
    // and strictObject would reject the whole config if they survived.
    const stored = validConfig();
    (stored.blocks[0] as Record<string, unknown>).style = {
      priceTagStyle: "pill",
      priceTagSize: "sm",
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed).not.toBeNull();
    const style = (parsed!.blocks[0] as { style?: Record<string, unknown> }).style;
    expect(style).toEqual({
      priceTagRadius: 24,
      priceTagBorderWidth: 1,
      priceTagSize: 10,
    });
  });

  it("keeps an explicit new value when a retired preset is present too", () => {
    // Half-migrated configs exist: the seller set a radius before the old key
    // was dropped. The stored number wins; the preset only fills a gap.
    const parsed = parseStoredStorefrontConfig({
      ...validConfig(),
      theme: { ...validConfig().theme, priceTagStyle: "pill", priceTagRadius: 6 },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.theme.priceTagRadius).toBe(6);
  });

  it("malformed header/embed degrade to absent instead of nuking the config", () => {
    const stored = {
      ...validConfig(),
      header: { show: "yes" },
      embed: { enabled: true, domains: ["https://not-allowed.com"] },
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed).not.toBeNull();
    expect(parsed!.header).toBeUndefined();
    expect(parsed!.embed).toBeUndefined();
  });

  it("returns null for non-object garbage", () => {
    expect(parseStoredStorefrontConfig(null)).toBeNull();
    expect(parseStoredStorefrontConfig("string")).toBeNull();
    expect(parseStoredStorefrontConfig(42)).toBeNull();
  });

  it("salvages any object shape to a safe default config (lenient by design)", () => {
    // Callers fall back to DEFAULT_STOREFRONT_CONFIG on null anyway, so an
    // object with no valid content degrading to defaults is equivalent — but
    // crucially nothing from the hostile input survives into the result.
    const parsed = parseStoredStorefrontConfig({ blocks: "no", evil: "x" });
    expect(parsed).not.toBeNull();
    expect(parsed!.blocks).toEqual([]);
    expect(parsed!.theme).toEqual(DEFAULT_STOREFRONT_CONFIG.theme);
    expect(JSON.stringify(parsed)).not.toContain("evil");
  });
});

const OWNER_UUID = "11111111-2222-4333-8444-555555555555";
const OBJ_UUID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const ELEMENT_KEY = `elements/${OWNER_UUID}/${OBJ_UUID}-logo.svg`;
const IMAGE_KEY = `images/${OWNER_UUID}/${OBJ_UUID}-photo.png`;

/** A config carrying one uploaded element, alone on the canvas. */
function configWithElement(
  overrides: Record<string, unknown> = {},
): StorefrontConfig {
  return structuredClone({
    ...DEFAULT_STOREFRONT_CONFIG,
    blocks: [
      {
        type: "image",
        id: UUID2,
        key: ELEMENT_KEY,
        alt: "Our logo",
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        ...overrides,
      },
    ],
  } as StorefrontConfig);
}

describe("image blocks — the seller's own artwork", () => {
  it("accepts a minimal element block", () => {
    expect(storefrontConfigSchema.safeParse(configWithElement()).success).toBe(true);
  });

  it("accepts every optional field at its bounds", () => {
    for (const patch of [
      { fit: "cover" },
      { fit: "contain" },
      { opacity: 0 },
      { opacity: 100 },
      { alt: "" },
      { alt: "a".repeat(IMAGE_ALT_MAX) },
      { imagePlacement: { x: 0, y: 100, scale: 300 } },
    ]) {
      const result = storefrontConfigSchema.safeParse(configWithElement(patch));
      expect(result.success, JSON.stringify(patch)).toBe(true);
    }
  });

  it("REFUSES a key that is not an element upload", () => {
    // The load-bearing one. `elements/` is the only prefix whose upload route
    // admits SVG, so an image block pointing anywhere else would render an
    // object that was never checked by the SVG sniffer.
    for (const key of [
      IMAGE_KEY,
      `fonts/${OWNER_UUID}/${OBJ_UUID}-face.woff2`,
      `files/${OWNER_UUID}/${OBJ_UUID}-bundle.zip`,
      `quarantine/elements/${OWNER_UUID}/${OBJ_UUID}-logo.svg`,
    ]) {
      const result = storefrontConfigSchema.safeParse(configWithElement({ key }));
      expect(result.success, key).toBe(false);
    }
  });

  it("REFUSES a key that is not a well-formed object key at all", () => {
    for (const key of [
      "https://evil.example/logo.svg",
      `elements/${OWNER_UUID}/../${OBJ_UUID}-logo.svg`,
      `elements/${OWNER_UUID}/not-a-uuid-logo.svg`,
      "elements/",
      "",
    ]) {
      const result = storefrontConfigSchema.safeParse(configWithElement({ key }));
      expect(result.success, key).toBe(false);
    }
  });

  it("refuses out-of-range and off-list field values", () => {
    for (const patch of [
      { fit: "fill" },
      { fit: 1 },
      { opacity: 101 },
      { opacity: -1 },
      { opacity: 50.5 },
      { alt: "a".repeat(IMAGE_ALT_MAX + 1) },
      { imagePlacement: { x: 0, y: 0, scale: 99 } },
      { imagePlacement: { x: -1, y: 0, scale: 100 } },
      { id: "not-a-uuid" },
    ]) {
      const result = storefrontConfigSchema.safeParse(configWithElement(patch));
      expect(result.success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("rejects unknown keys, so nothing rides along in the jsonb", () => {
    const result = storefrontConfigSchema.safeParse(
      configWithElement({ onload: "evil()", src: "https://evil.example" }),
    );
    expect(result.success).toBe(false);
  });

  it("holds elements to the same canvas invariants as every other block", () => {
    // Overlap and bounds are config-level rules; a new block type must not
    // arrive with an exemption from them.
    const overlapping = configWithElement();
    overlapping.blocks.push({
      type: "shape",
      id: UUID,
      kind: "circle",
      color: "#171717",
      x: 1,
      y: 1,
      w: 2,
      h: 2,
    });
    expect(storefrontConfigSchema.safeParse(overlapping).success).toBe(false);

    const outside = configWithElement({ x: 5, y: 5, w: 4, h: 4 });
    expect(storefrontConfigSchema.safeParse(outside).success).toBe(false);
  });

  it("keys image blocks distinctly, so one cannot collide with another kind", () => {
    const config = configWithElement();
    // Same uuid on a text block: different key prefixes keep them unique.
    config.blocks.push({
      type: "text",
      id: UUID2,
      text: "hi",
      variant: "body",
      align: "left",
      x: 3,
      y: 0,
      w: 1,
      h: 1,
    });
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);
  });

  it("survives a store-and-reload round trip", () => {
    const parsed = parseStoredStorefrontConfig(
      JSON.parse(JSON.stringify(configWithElement({ fit: "contain", opacity: 40 }))),
    );
    expect(parsed).not.toBeNull();
    const block = parsed!.blocks[0];
    expect(block.type).toBe("image");
    expect(block).toMatchObject({ key: ELEMENT_KEY, fit: "contain", opacity: 40 });
  });
});
