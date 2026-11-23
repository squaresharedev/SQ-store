import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  parseStoredStorefrontConfig,
  storefrontConfigSchema,
} from "@/lib/validation/storefront";
import {
  MAX_REPAIR_ROUNDS,
  repairUnreadable,
} from "@/lib/validation/storefront-repair";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import newFieldsConfig from "../fixtures/storefront/new-fields-config.json";

/**
 * The read side must understand a config written by NEWER code (a rollback
 * leaves those in the database): see repairUnreadable. The fixture is a real
 * config from the editor upgrade, using every field it added.
 */

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UUID2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const fixture = () => structuredClone(newFieldsConfig) as Record<string, any>;

function block(type: string, extra: Record<string, unknown>) {
  return { type, x: 0, y: 0, w: 1, h: 1, ...extra };
}

/** A config main writes itself: every block type, a header. */
function currentConfig() {
  return structuredClone({
    ...DEFAULT_STOREFRONT_CONFIG,
    blocks: [
      block("product", { productId: UUID }),
      block("text", { id: UUID, text: "Hello", variant: "body", align: "left", x: 1 }),
      block("shape", { id: UUID2, kind: "circle", color: "#112233", x: 2 }),
      block("image", {
        id: "cccccccc-dddd-4eee-8fff-000000000000",
        key: `elements/${UUID}/${UUID2}-art.webp`,
        alt: "Art",
        x: 3,
      }),
    ],
    header: { show: true, name: "Shop", bio: "Things" },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("a config written by newer code", () => {
  it("reads to a config, keeping what this version knows", () => {
    const parsed = parseStoredStorefrontConfig(fixture());
    expect(parsed).not.toBeNull();

    // The blocks it understands survive in order; the new types, and the text
    // block whose variant this version does not know, are gone.
    expect(parsed!.blocks.map((b) => b.type)).toEqual([
      "text",
      "text",
      "image",
      "shape",
      "product",
      "product",
      "product",
      "text",
      "product",
      "product",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("Picked by hand");
    expect(JSON.stringify(parsed)).not.toContain("Shop the camera");

    // Every theme member this version knows is kept as stored.
    const original = fixture().theme;
    expect(parsed!.theme).toMatchObject({
      accent: original.accent,
      font: original.font,
      columns: original.columns,
      rows: original.rows,
      cornerRadius: original.cornerRadius,
      titleStyle: original.titleStyle,
      titleDisplay: original.titleDisplay,
      priceDisplay: original.priceDisplay,
      gridGap: original.gridGap,
      soldOutBadge: original.soldOutBadge,
      background: { kind: "gradient", from: "#f4efe6", to: "#e6dccb", angle: 180 },
    });
    // The new members, and the gradient's third stop, are not carried over.
    for (const unknown of ["palette", "fontPairing", "textStyles", "motion", "texture", "cardColor"]) {
      expect(parsed!.theme).not.toHaveProperty(unknown);
    }
    expect(parsed!.theme.background).not.toHaveProperty("via");

    // The header keeps its known members; the new ones go.
    expect(parsed!.header).toEqual({
      show: true,
      name: "Parallel Goods",
      bio: "Objects for slow mornings.",
    });

    // Block members this version knows are untouched; the new ones are gone.
    expect(parsed!.blocks[0]).toEqual({
      type: "text",
      id: "ed0de300-0000-4000-8000-000000000011",
      text: "Things for slow mornings",
      variant: "heading",
      align: "left",
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    });
    expect(parsed).not.toHaveProperty("bands");

    // What came out is a config this version would itself have written.
    expect(storefrontConfigSchema.safeParse(parsed).success).toBe(true);
  });

  it("does not change the stored value it was handed", () => {
    const stored = fixture();
    parseStoredStorefrontConfig(stored);
    expect(stored).toEqual(fixture());
  });

  it("logs the dropped paths once, with no seller content", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseStoredStorefrontConfig(fixture());
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line).toContain("theme.palette");
    expect(line).toContain("bands");
    expect(line).not.toContain("Things for slow mornings");
    expect(line).not.toContain("Parallel Goods");
  });

  it("drops an unknown value in an optional field and keeps the block", () => {
    const stored = currentConfig();
    (stored.blocks[2] as Record<string, unknown>).blurDirection = "swirl";
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed).not.toBeNull();
    expect(parsed!.blocks).toHaveLength(4);
    expect(parsed!.blocks[2]).toMatchObject({ type: "shape", kind: "circle" });
    expect(parsed!.blocks[2]).not.toHaveProperty("blurDirection");
  });

  it("drops a block with a shape kind it does not know, never the whole config", () => {
    const stored = currentConfig();
    (stored.blocks[2] as Record<string, unknown>).kind = "hexagon-of-the-future";
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed!.blocks.map((b) => b.type)).toEqual(["product", "text", "image"]);
  });

  it("keeps a header that carries only an unknown key", () => {
    const stored = {
      ...currentConfig(),
      header: { show: true, name: "Shop", bio: "Things", logo: { key: "x" } },
    };
    const parsed = parseStoredStorefrontConfig(stored);
    expect(parsed!.header).toEqual({ show: true, name: "Shop", bio: "Things" });
    expect(parsed!.blocks).toHaveLength(4);
  });
});

describe("the embed allowlist", () => {
  it("loses an unknown key but never one of its domains", () => {
    const withKey = parseStoredStorefrontConfig({
      ...currentConfig(),
      embed: { enabled: true, domains: ["example.com"], theme: "dark" },
    });
    expect(withKey!.embed).toEqual({ enabled: true, domains: ["example.com"] });

    // A known-but-wrong entry is not repaired by dropping it: that would
    // change who may embed. The whole setting is absent, as it always was.
    const wrongEntry = parseStoredStorefrontConfig({
      ...currentConfig(),
      embed: { enabled: true, domains: ["example.com", "https://not-allowed.com"] },
    });
    expect(wrongEntry).not.toBeNull();
    expect(wrongEntry!.embed).toBeUndefined();
  });
});

describe("a config this version already reads", () => {
  it("comes out exactly as stored, without a log line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const stored of [DEFAULT_STOREFRONT_CONFIG, currentConfig()]) {
      const direct = storefrontConfigSchema.parse(stored);
      expect(parseStoredStorefrontConfig(stored)).toEqual(direct);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("still upgrades the older shapes, quietly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = parseStoredStorefrontConfig({
      theme: { background: "#123456", accent: "#000000", font: "sans", radius: "none" },
      blocks: [{ productId: UUID, size: "2x2", order: 0 }],
      seller: { name: "retired" },
    });
    expect(parsed!.theme.background).toEqual({ kind: "solid", color: "#123456" });
    expect(parsed!.blocks[0]).toMatchObject({ type: "product", productId: UUID });
    expect(warn).not.toHaveBeenCalled();
  });

  it("still degrades a header that cannot be read to none", () => {
    const parsed = parseStoredStorefrontConfig({
      ...currentConfig(),
      header: { show: "yes" },
    });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("header");
  });
});

describe("garbage", () => {
  it.each([
    ["a string", "{}"],
    ["null", null],
    ["a number", 7],
  ])("is null for %s", (_label, raw) => {
    expect(parseStoredStorefrontConfig(raw)).toBeNull();
  });

  it("is null when a required theme field is broken beyond repair", () => {
    const theme = DEFAULT_STOREFRONT_CONFIG.theme;
    expect(parseStoredStorefrontConfig({ theme: { ...theme, columns: "wide" }, blocks: [] })).toBeNull();
    expect(parseStoredStorefrontConfig({ theme: { ...theme, accent: "red" }, blocks: [] })).toBeNull();
  });

  it("is null when the blocks collide, rather than guessing which to keep", () => {
    const twin = block("shape", { id: UUID, kind: "circle", color: "#000000" });
    expect(
      parseStoredStorefrontConfig({
        theme: DEFAULT_STOREFRONT_CONFIG.theme,
        blocks: [twin, { ...twin }],
      }),
    ).toBeNull();
  });
});

describe("repairUnreadable", () => {
  it("never loops forever, even when the schema keeps bringing the problem back", () => {
    let parses = 0;
    // A preprocess that re-adds a bad item every time: the worst case for a
    // repair loop. The cap is what ends it.
    const hostile = z.preprocess(
      (value) => {
        parses++;
        const base = value as { items?: unknown[] };
        return { ...base, items: [...(base.items ?? []), "bad"] };
      },
      z.strictObject({ items: z.array(z.number()) }),
    );
    expect(repairUnreadable(hostile, { items: [1] })).toBeNull();
    expect(parses).toBeLessThanOrEqual(MAX_REPAIR_ROUNDS);
  });

  it("gives up when nothing can be dropped", () => {
    expect(repairUnreadable(z.number(), {})).toBeNull();
    expect(repairUnreadable(z.strictObject({ a: z.number() }), { a: "x" })).toBeNull();
  });

  it("removes only the failing array items", () => {
    const schema = z.strictObject({ list: z.array(z.strictObject({ n: z.number() })) });
    const repaired = repairUnreadable(schema, {
      list: [{ n: 1 }, { n: "x" }, { n: 3, extra: true }, { m: 4 }],
    });
    expect(repaired!.data).toEqual({ list: [{ n: 1 }, { n: 3 }] });
    expect(repaired!.dropped).toEqual(
      expect.arrayContaining(["list.1", "list.2.extra", "list.3"]),
    );
  });
});
