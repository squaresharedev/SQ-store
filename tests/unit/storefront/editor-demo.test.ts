import { describe, expect, it } from "vitest";
import { editorDemoConfig, editorDemoPhotoEdges } from "@/app/dev/editor-demo/demo-config";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import { derivePalette, isColorKey } from "@/lib/storefront/palette";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import type { StorefrontConfig } from "@/types/storefront";

// THE DEMO STOREFRONT (/dev/editor-demo) is the upgrade's checklist: one
// config wearing every feature that shipped. It has to be a storefront a
// seller could really save, and it has to keep wearing all of it.

const demo: StorefrontConfig = editorDemoConfig(buildSampleStorefront((key) => key));

describe("the editor upgrade's demo storefront", () => {
  it("is a storefront the schema accepts, unchanged", () => {
    const parsed = storefrontConfigSchema.safeParse(structuredClone(demo));
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data).toEqual(demo);
  });

  it("wears every theme feature that shipped", () => {
    const { theme } = demo;
    expect(theme.palette).toBeDefined();
    expect(theme.fontPairing).toBeDefined();
    expect(Object.keys(theme.textStyles ?? {}).length).toBeGreaterThanOrEqual(3);
    expect(theme.background).toMatchObject({ kind: "gradient", via: expect.any(String) });
    expect(theme.motion).not.toBe("none");
    expect(theme.texture).not.toBe("none");
    for (const member of ["cardColor", "whiteBlend", "titleBarColor", "titleTextColor", "titleFont", "photoShape", "shadow"] as const) {
      expect(theme[member], member).toBeDefined();
    }
  });

  it("wears every block feature that shipped", () => {
    const { blocks } = demo;
    const kinds = new Set(blocks.map((block) => block.type));
    expect([...kinds].sort()).toEqual(["button", "carousel", "image", "marquee", "product", "shape", "text"]);

    const texts = blocks.filter((block) => block.type === "text");
    expect(new Set(texts.map((block) => block.valign))).toEqual(new Set(["top", "middle", "bottom", undefined]));
    expect(texts.some((block) => block.variant === "label")).toBe(true);
    expect(blocks.filter((block) => "fine" in block && block.fine).length).toBeGreaterThanOrEqual(4);

    const shape = blocks.find((block) => block.type === "shape");
    expect(shape).toMatchObject({ gradient: expect.any(Object), shadow: "soft" });
    const image = blocks.find((block) => block.type === "image");
    expect(image).toMatchObject({ shape: "circle", shadow: "lifted" });

    const cards = blocks.filter((block) => block.type === "product");
    // "auto" has white-edged photos to blend: a fact about each PRODUCT's
    // photo, handed to the board with the product, never stored on a card.
    const edges = editorDemoPhotoEdges(buildSampleStorefront((key) => key));
    expect(cards.some((card) => edges[card.productId] === "white")).toBe(true);
    expect(cards.some((card) => edges[card.productId] === "other")).toBe(true);
    expect(cards.every((card) => !("photoEdge" in card))).toBe(true);
    expect(cards.some((card) => card.style?.photoShape && card.style.shadow)).toBe(true);
    expect(cards.some((card) => card.style?.cardColor && card.style.whiteBlend === "on")).toBe(true);

    // The carousel holds every product, in an order of its own.
    const carousel = blocks.find((block) => block.type === "carousel");
    const tiles = cards.map((card) => card.productId);
    expect(carousel?.type === "carousel" && [...carousel.productIds].sort()).toEqual([...tiles].sort());
    expect(carousel?.type === "carousel" && carousel.productIds).not.toEqual(tiles);
    expect(carousel?.w).toBeGreaterThanOrEqual(3);

    const buttons = blocks.filter((block) => block.type === "button");
    expect(new Set(buttons.map((button) => button.link.kind))).toEqual(new Set(["product", "band", "url"]));
    expect(new Set(buttons.map((button) => button.look ?? "solid"))).toEqual(new Set(["solid", "outline", "link"]));
  });

  it("has a band of each kind, and a header with a logo and a menu", () => {
    expect(new Set(demo.bands?.map((band) => band.background.kind))).toEqual(new Set(["solid", "gradient", "image"]));
    expect(demo.header?.logo).toBeDefined();
    expect(demo.header?.links?.length).toBeGreaterThanOrEqual(3);
  });

  it("takes every colour it wears from its own palette", () => {
    const palette = new Set(Object.values(derivePalette(demo.theme)).map((hex) => hex.toLowerCase()));
    const strays: string[] = [];
    const walk = (value: unknown, path: string, underColorKey: boolean) => {
      if (typeof value === "string") {
        if (underColorKey && /^#[0-9a-f]{6}$/i.test(value) && !palette.has(value.toLowerCase())) strays.push(`${path} = ${value}`);
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`, false));
      } else if (value && typeof value === "object") {
        for (const [key, member] of Object.entries(value)) walk(member, `${path}.${key}`, isColorKey(key) || path.endsWith(".palette"));
      }
    };
    walk(demo, "config", false);
    expect(strays).toEqual([]);
  });
});
