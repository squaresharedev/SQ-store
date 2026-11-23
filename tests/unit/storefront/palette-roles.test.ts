import { describe, expect, it } from "vitest";
import {
  FIELD_ROLES,
  backgroundIsPhoto,
  derivePalette,
  isColorKey,
  paletteRoleOf,
  recolourPaletteIn,
  recolourThemePalette,
  withBackground,
} from "@/lib/storefront/palette";
import { DEFAULT_STOREFRONT_CONFIG, PALETTE_SLOTS, type StorefrontPalette, type StorefrontTheme } from "@/types/storefront";

/**
 * PALETTE ROLES. A palette change recolours by value; when two slots wear the
 * same hex a value cannot say which slot it is, so the fields whose ROLE is
 * the slot follow it and the rest stay. Not shared: every field follows.
 */

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({ ...DEFAULT_STOREFRONT_CONFIG.theme, ...over });
const NEW = "#0f766e";

/** A palette whose slots are all different, so nothing is shared by accident. */
const DISTINCT: StorefrontPalette = {
  background: "#f3eee6",
  text: "#1f1b16",
  accent: "#9a3412",
  surface: "#fffaf0",
  muted: "#e6dccd",
};

/** Every colour field the role map knows, each wearing `hex`. */
function everyField(hex: string) {
  return {
    theme: theme({
      background: { kind: "solid", color: hex },
      accent: hex,
      cardColor: hex,
      titleBarColor: hex,
      titleTextColor: hex,
      buyButtonColor: hex,
      buyButtonTextColor: hex,
      textStyles: { heading: { color: hex }, body: { color: hex } },
    }),
    header: { nameColor: hex, bioColor: hex },
    productPage: { backgroundColor: hex, ctaColor: hex, ctaBorderColor: hex, starColor: hex },
    checkoutPage: { backgroundColor: hex },
    blocks: [
      { type: "product", style: { cardColor: hex, titleBarColor: hex, titleTextColor: hex } },
      { type: "shape", color: hex, borderColor: hex, gradient: { from: hex, to: hex } },
      { type: "text", variant: "heading", color: hex, spans: [{ color: hex }] },
      { type: "text", variant: "body", color: hex, spans: [{ color: hex }] },
      { type: "marquee", color: hex },
      { type: "marquee", variant: "heading", color: hex },
    ],
    bands: [{ background: { kind: "solid", color: hex } }, { background: { kind: "gradient", from: hex, to: hex } }],
  };
}

type Field = ReturnType<typeof everyField>;

/** The slot each field of everyField belongs to, by where it sits. */
const WHO: Record<string, string | undefined> = {
  "theme.accent": "accent",
  "theme.background.color": "background",
  "theme.cardColor": "surface",
  "theme.titleBarColor": "surface",
  "theme.titleTextColor": "text",
  "theme.buyButtonColor": "accent",
  "theme.textStyles.heading.color": "accent",
  "theme.textStyles.body.color": "text",
  "header.nameColor": "accent",
  "header.bioColor": "text",
  "productPage.backgroundColor": "background",
  "productPage.ctaColor": "accent",
  "checkoutPage.backgroundColor": "background",
  "blocks.0.style.cardColor": "surface",
  "blocks.0.style.titleBarColor": "surface",
  "blocks.0.style.titleTextColor": "text",
  "blocks.2.color": "accent",
  "blocks.2.spans.0.color": "accent",
  "blocks.3.color": "text",
  "blocks.3.spans.0.color": "text",
  "blocks.4.color": "text",
  "blocks.5.color": "accent",
  "bands.0.background.color": "muted",
};

/** Every path under a colour key that holds a hex, as "a.b.0.c". */
function colourPaths(value: unknown, path: string[] = [], key = ""): string[] {
  if (typeof value === "string") return key && isColorKey(key) && value.startsWith("#") ? [path.join(".")] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => colourPaths(item, [...path, String(index)], ""));
  if (value && typeof value === "object") {
    // The stored palette is the record of the five, not a field the walk recolours.
    return Object.entries(value).flatMap(([member, inner]) => (member === "palette" ? [] : colourPaths(inner, [...path, member], member)));
  }
  return [];
}

const at = (state: object, path: string) =>
  path.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], state);

/** The fields that moved, as paths. */
function moved(before: Field, after: Field): string[] {
  return colourPaths(before).filter((path) => at(before, path) !== at(after, path));
}

describe("the role of a colour field", () => {
  it("is decided from the field's name where the name says what it is", () => {
    for (const [key, slot] of Object.entries(FIELD_ROLES)) {
      expect(isColorKey(key)).toBe(true);
      expect(paletteRoleOf({ path: ["anywhere"] }, key)).toBe(slot);
    }
  });

  it("gives every one of the five slots a field, Muted a band's solid colour", () => {
    const roles = new Set(Object.values(WHO));
    for (const slot of PALETTE_SLOTS) expect(roles).toContain(slot);
  });

  it("reads `color` by where it sits", () => {
    expect(paletteRoleOf({ path: ["theme", "background"] }, "color")).toBe("background");
    expect(paletteRoleOf({ path: ["theme", "background"] }, "from")).toBe("background");
    expect(paletteRoleOf({ path: ["theme", "background"] }, "via")).toBe("background");
    expect(paletteRoleOf({ path: ["theme", "background"] }, "to")).toBe("background");
    expect(paletteRoleOf({ path: ["bands", "background"] }, "color")).toBe("muted");
    expect(paletteRoleOf({ path: ["blocks"], ink: { variant: "heading" } }, "color")).toBe("accent");
    expect(paletteRoleOf({ path: ["blocks"], ink: { variant: "label" } }, "color")).toBe("text");
    expect(paletteRoleOf({ path: ["blocks"], ink: {} }, "color")).toBe("text");
  });

  it("gives none to a shape's fill, a gradient's stops, a band's gradient or an outline", () => {
    expect(paletteRoleOf({ path: ["blocks"] }, "color")).toBeUndefined();
    expect(paletteRoleOf({ path: ["blocks"] }, "borderColor")).toBeUndefined();
    expect(paletteRoleOf({ path: ["blocks", "gradient"] }, "from")).toBeUndefined();
    expect(paletteRoleOf({ path: ["bands", "background"] }, "from")).toBeUndefined();
    expect(paletteRoleOf({ path: ["productPage"] }, "starColor")).toBeUndefined();
    expect(paletteRoleOf({ path: ["productPage"] }, "ctaBorderColor")).toBeUndefined();
    expect(paletteRoleOf({ path: ["theme"] }, "priceTagColor")).toBeUndefined();
  });
});

describe("when the hex is NOT shared, every field follows, role or not", () => {
  it("recolours every colour field wearing the old colour, whatever its role", () => {
    for (const slot of PALETTE_SLOTS) {
      const base = everyField(DISTINCT[slot]);
      const state = { ...base, theme: { ...base.theme, palette: DISTINCT } };
      const next = recolourPaletteIn(state, slot, NEW);
      // Everything that wore the colour wears the new one: nothing is left behind.
      for (const path of colourPaths(state)) expect(at(next, path)).toBe(NEW);
      expect(next.theme.palette).toEqual({ ...DISTINCT, [slot]: NEW });
    }
  });

  it("leaves a colour no slot wears alone", () => {
    const state = { ...everyField("#123456"), theme: theme({ palette: DISTINCT, accent: DISTINCT.accent }) };
    const next = recolourPaletteIn(state, "accent", NEW);
    expect(moved(state as unknown as Field, next as unknown as Field)).toEqual(["theme.accent"]);
  });
});

describe("when the hex IS shared, a field follows only its own slot", () => {
  /** Two slots in one colour, the other three apart. */
  const sharing = (a: keyof StorefrontPalette, b: keyof StorefrontPalette, hex: string): StorefrontPalette => ({
    ...DISTINCT,
    [a]: hex,
    [b]: hex,
  });

  function change(palette: StorefrontPalette, hexWorn: string, slot: keyof StorefrontPalette) {
    const base = everyField(hexWorn);
    const state = { ...base, theme: { ...base.theme, palette } };
    const next = recolourPaletteIn(state, slot, NEW);
    return { state, next, paths: moved(state, next) };
  }

  it("moves exactly the fields of Surface when Surface shares with Background (a white board, white cards)", () => {
    const { paths, next } = change(sharing("background", "surface", "#ffffff"), "#ffffff", "surface");
    expect(paths.sort()).toEqual(Object.keys(WHO).filter((path) => WHO[path] === "surface").sort());
    // The board's own colour stayed white, and so did a shape painted white.
    expect(next.theme.background).toEqual({ kind: "solid", color: "#ffffff" });
    expect(next.blocks[1]).toMatchObject({ color: "#ffffff" });
    expect(next.theme.palette).toEqual({ ...sharing("background", "surface", "#ffffff"), surface: NEW });
  });

  it("moves exactly the fields of Background when Background shares with Surface", () => {
    const { paths, next } = change(sharing("background", "surface", "#ffffff"), "#ffffff", "background");
    expect(paths.sort()).toEqual(Object.keys(WHO).filter((path) => WHO[path] === "background").sort());
    expect(next.theme.background).toEqual({ kind: "solid", color: NEW });
    expect(next.theme.cardColor).toBe("#ffffff");
  });

  it("separates Accent from Text (a new storefront's text and accent are one ink)", () => {
    const palette = sharing("text", "accent", "#1c1917");
    const accent = change(palette, "#1c1917", "accent");
    expect(accent.paths.sort()).toEqual(Object.keys(WHO).filter((path) => WHO[path] === "accent").sort());
    expect(accent.next.theme.accent).toBe(NEW);
    expect(accent.next.header.bioColor).toBe("#1c1917");
    expect(accent.next.blocks[3]).toMatchObject({ color: "#1c1917" });

    const text = change(palette, "#1c1917", "text");
    expect(text.paths.sort()).toEqual(Object.keys(WHO).filter((path) => WHO[path] === "text").sort());
    expect(text.next.theme.accent).toBe("#1c1917");
    expect(text.next.header.bioColor).toBe(NEW);
  });

  it("moves a band's solid colour with Muted and leaves it when Surface moves", () => {
    const palette = sharing("muted", "surface", "#eeeeee");
    const muted = change(palette, "#eeeeee", "muted");
    expect(muted.paths).toEqual(["bands.0.background.color"]);
    const surface = change(palette, "#eeeeee", "surface");
    expect(surface.paths).not.toContain("bands.0.background.color");
    expect(surface.paths).toContain("theme.cardColor");
  });

  it("moves a gradient board's stops with Background, and a shape's gradient with nothing", () => {
    const hex = "#ffffff";
    const palette = sharing("background", "surface", hex);
    const state = {
      theme: theme({ palette, background: { kind: "gradient", from: hex, via: hex, to: hex, angle: 160 } }),
      blocks: [{ type: "shape", color: hex, gradient: { from: hex, to: hex } }],
    };
    const next = recolourPaletteIn(state, "background", NEW);
    expect(next.theme.background).toMatchObject({ kind: "gradient", from: NEW, via: NEW, to: NEW });
    expect(next.blocks[0]).toEqual(state.blocks[0]);
    const surface = recolourPaletteIn(state, "surface", NEW);
    expect(surface.theme.background).toEqual(state.theme.background);
  });

  it("a field with no role stays, whichever slot moves", () => {
    for (const slot of ["background", "surface"] as const) {
      const { next } = change(sharing("background", "surface", "#ffffff"), "#ffffff", slot);
      expect(next.blocks[1]).toMatchObject({ color: "#ffffff", borderColor: "#ffffff" });
      expect(next.productPage).toMatchObject({ ctaBorderColor: "#ffffff", starColor: "#ffffff" });
      expect(next.bands[1]).toEqual({ background: { kind: "gradient", from: "#ffffff", to: "#ffffff" } });
    }
  });

  it("works on a theme alone, and on a derived palette (nothing stored yet)", () => {
    const legacy = theme({ background: { kind: "solid", color: "#ffffff" }, cardColor: "#ffffff", accent: "#7c2d12" });
    expect(derivePalette(legacy).background).toBe(derivePalette(legacy).surface);
    const next = recolourThemePalette(legacy, "surface", NEW);
    expect(next.cardColor).toBe(NEW);
    expect(next.background).toEqual({ kind: "solid", color: "#ffffff" });
    expect(next.palette).toMatchObject({ background: "#ffffff", surface: NEW });
  });

  it("does not touch a text block whose words happen to be a colour", () => {
    const state = { theme: theme({ palette: sharing("text", "accent", "#1c1917"), accent: "#1c1917" }), blocks: [{ type: "text", text: "#1c1917" }] };
    expect(recolourPaletteIn(state, "accent", NEW).blocks[0]).toEqual(state.blocks[0]);
  });
});

describe("a PHOTO board's Background wears nothing", () => {
  const photo = { kind: "image" as const, key: "images/u/a.png", x: 50, y: 50, scale: 100 };

  it("is told from the others by the background's kind", () => {
    expect(backgroundIsPhoto(theme({ background: photo }))).toBe(true);
    expect(backgroundIsPhoto(theme())).toBe(false);
  });

  it("is not another slot's colour: the accent follows everywhere even when it equals the stand-in", () => {
    // The stand-in for a photo is the dark ink, and a new storefront's accent is dark too.
    const standIn = derivePalette(theme({ background: photo })).background;
    const state = { theme: theme({ background: photo, accent: standIn }), blocks: [{ type: "shape", color: standIn }] };
    const next = recolourPaletteIn(state, "accent", NEW);
    expect(next.theme.accent).toBe(NEW);
    expect(next.blocks[0]).toMatchObject({ color: NEW });
  });

  it("choosing a colour replaces the photo with it and recolours nothing", () => {
    const standIn = derivePalette(theme({ background: photo })).background;
    const state = { theme: theme({ background: photo, accent: standIn }), blocks: [{ type: "shape", color: standIn }] };
    const next = recolourPaletteIn(state, "background", NEW);
    expect(next.theme.background).toEqual({ kind: "solid", color: NEW });
    expect(next.theme.palette?.background).toBe(NEW);
    expect(next.theme.accent).toBe(standIn);
    expect(next.blocks[0]).toEqual(state.blocks[0]);
  });

  it("keeps the photo while any OTHER slot is changed", () => {
    const next = recolourThemePalette(theme({ background: photo }), "accent", NEW);
    expect(next.background).toEqual(photo);
    expect(next.accent).toBe(NEW);
  });
});

describe("withBackground", () => {
  it("makes a solid background the palette's Background, once a palette is stored", () => {
    const stored = theme({ palette: DISTINCT });
    expect(withBackground(stored, { kind: "solid", color: NEW }).palette).toEqual({ ...DISTINCT, background: NEW });
    // A gradient or a photo leaves the palette as it was.
    const gradient = { kind: "gradient" as const, from: NEW, to: "#ffffff", angle: 90 };
    expect(withBackground(stored, gradient).palette).toEqual(DISTINCT);
  });

  it("stores no palette on a storefront that has none", () => {
    const plain = theme();
    expect(withBackground(plain, { kind: "solid", color: NEW }).palette).toBeUndefined();
  });
});
