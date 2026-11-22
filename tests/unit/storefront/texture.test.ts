import { describe, expect, it } from "vitest";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontBackground } from "@/types/storefront";
import { TEXTURE_TILE_PX, textureLayer, withTexture, withTextureLayer } from "@/lib/storefront/texture";
import { boardBackgroundStyle, resolveBackgroundStyle } from "@/components/storefront/background-presets";

const THEME = DEFAULT_STOREFRONT_CONFIG.theme;
const IMAGE: StorefrontBackground = { kind: "image", key: "images/u/x-photo.jpg", x: 30, y: 60, scale: 120 };

describe("textureLayer", () => {
  it("is nothing when absent or off", () => {
    expect(textureLayer(undefined)).toBeNull();
    expect(textureLayer("none")).toBeNull();
  });

  it("is drawn in code: an inline SVG noise, nothing fetched", () => {
    const layer = textureLayer("light")!;
    expect(layer.image.startsWith('url("data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(layer.image.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain("feTurbulence");
    // The only address in it is the SVG namespace, which is a name, not a request.
    expect(svg.replace("http://www.w3.org/2000/svg", "")).not.toMatch(/https?:|href|@import/);
    expect(layer.size).toBe(`${TEXTURE_TILE_PX}px ${TEXTURE_TILE_PX}px`);
  });

  it("shows more grain when strong", () => {
    const opacity = (texture: "light" | "strong") =>
      Number(/opacity='([\d.]+)'/.exec(decodeURIComponent(textureLayer(texture)!.image))![1]);
    expect(opacity("strong")).toBeGreaterThan(opacity("light"));
  });
});

describe("withTextureLayer", () => {
  it("returns the background's own style untouched without a texture", () => {
    const style = resolveBackgroundStyle(THEME.background);
    expect(withTextureLayer(style, undefined)).toBe(style);
    expect(boardBackgroundStyle(THEME)).toEqual(resolveBackgroundStyle(THEME.background));
  });

  it("lays the grain over a colour", () => {
    const style = withTextureLayer({ backgroundColor: "#ffffff" }, "light");
    expect(style.backgroundColor).toBe("#ffffff");
    expect(style.backgroundImage).toBe(textureLayer("light")!.image);
  });

  it("lays the grain over a gradient, which keeps filling the board", () => {
    const style = withTextureLayer(resolveBackgroundStyle({ kind: "gradient", from: "#ffffff", to: "#000000", angle: 90 }), "strong");
    expect(style.backgroundImage).toBe(`${textureLayer("strong")!.image}, linear-gradient(90deg, #ffffff, #000000)`);
    expect(style.backgroundSize).toBe(`${TEXTURE_TILE_PX}px ${TEXTURE_TILE_PX}px, auto`);
  });

  it("lays the grain over a photo, which keeps its own size, place and repeat", () => {
    const style = withTextureLayer(resolveBackgroundStyle(IMAGE, "https://r2.example/x.jpg"), "light");
    expect(String(style.backgroundImage).endsWith('url("https://r2.example/x.jpg")')).toBe(true);
    expect(style.backgroundSize).toBe(`${TEXTURE_TILE_PX}px ${TEXTURE_TILE_PX}px, 120% auto`);
    expect(style.backgroundPosition).toBe("0 0, 30% 60%");
    expect(style.backgroundRepeat).toBe("repeat, no-repeat");
  });
});

describe("withTexture", () => {
  it("drops the key when turned off, and changes nothing when nothing changes", () => {
    const grained = withTexture(THEME, "strong");
    expect(grained.texture).toBe("strong");
    expect(withTexture(grained, "strong")).toBe(grained);
    const plain = withTexture(grained, "none");
    expect("texture" in plain).toBe(false);
    expect(withTexture(THEME, "none")).toBe(THEME);
  });
});
