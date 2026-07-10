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
  TEXT_MAX_LENGTH,
  type StorefrontConfig,
} from "@/types/storefront";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UUID2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function validConfig(): StorefrontConfig {
  return structuredClone({
    ...DEFAULT_STOREFRONT_CONFIG,
    blocks: [
      { type: "product", productId: UUID, size: "2x2", order: 0 },
      {
        type: "text",
        id: UUID2,
        text: "hello\nworld",
        variant: "heading",
        align: "left",
        size: "2x1",
        order: 1,
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

  it("rejects unknown pattern presets (allowlist only)", () => {
    const cfg = validConfig();
    cfg.theme.background = {
      kind: "pattern",
      preset: "url(evil)" as never,
      color: "#ffffff",
    };
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
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

  it("rejects more than MAX_BLOCKS blocks", () => {
    const cfg = validConfig();
    cfg.blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({
      type: "shape" as const,
      id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
      kind: "square" as const,
      color: "#000000",
      size: "1x1" as const,
      order: i,
    }));
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects duplicate blocks (same product twice / same shape id twice)", () => {
    const cfg = validConfig();
    cfg.blocks = [
      { type: "product", productId: UUID, size: "1x1", order: 0 },
      { type: "product", productId: UUID, size: "2x2", order: 1 },
    ];
    expect(storefrontConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects invalid sizes and orders", () => {
    const bad = [
      { size: "4x4" },
      { size: "0x1" },
      { size: "1x1", order: -1 },
      { size: "1x1", order: 10_000 },
      { size: "1x1", order: 1.5 },
    ];
    for (const patch of bad) {
      const cfg = validConfig();
      Object.assign(cfg.blocks[0], patch);
      expect(storefrontConfigSchema.safeParse(cfg).success, JSON.stringify(patch)).toBe(false);
    }
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
    expect(parsed!.theme.cardStyle).toBe(DEFAULT_STOREFRONT_CONFIG.theme.cardStyle);
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
