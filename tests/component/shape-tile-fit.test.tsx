import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SHAPE_KINDS, type ShapeBlock, type ShapeKind } from "@/types/storefront";
import { ShapeTileContent } from "@/components/storefront/ShapeTileContent";
import { isPathKind, shapePath } from "@/components/storefront/shape-geometry";

/**
 * Shape rendering contract: every shape fills its tile edge to edge and
 * stretches with it (a circle on a wide tile IS an oval). Path kinds render
 * one stretched SVG whose geometry comes from shape-geometry (so points and
 * corner roundness are adjustable); box kinds are CSS boxes whose adjustable
 * roundness is applied in cqmin, uniform on stretched tiles.
 */

afterEach(cleanup);

function block(kind: ShapeKind, over: Partial<ShapeBlock> = {}): ShapeBlock {
  return {
    type: "shape",
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    kind,
    color: "#171717",
    x: 0,
    y: 0,
    w: 2,
    h: 1,
    ...over,
  };
}

function renderShape(kind: ShapeKind, over: Partial<ShapeBlock> = {}) {
  const { container } = render(<ShapeTileContent block={block(kind, over)} />);
  return container;
}

describe("shape tile rendering", () => {
  it("wrapper is an edge-to-edge size container (no padding)", () => {
    const wrapper = renderShape("square").firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("[container-type:size]");
    expect(wrapper.className).not.toMatch(/\bp-2\b/);
  });

  it("circle and ring stretch into ovals (per-axis 50% radius, full size)", () => {
    for (const kind of ["circle", "ring"] as const) {
      const body = renderShape(kind).querySelector('[aria-hidden="true"]')!;
      expect(body.className, kind).toContain("size-full");
      expect(body.className, kind).toContain("rounded-[50%]");
      cleanup();
    }
  });

  it("path kinds render one stretched SVG with generated geometry", () => {
    for (const kind of SHAPE_KINDS.filter(isPathKind)) {
      const svg = renderShape(kind).querySelector("svg")!;
      expect(svg, kind).not.toBeNull();
      expect(svg.getAttribute("preserveAspectRatio"), kind).toBe("none");
      expect(svg.classList.contains("size-full"), kind).toBe(true);
      const d = svg.querySelector("path")!.getAttribute("d")!;
      expect(d, kind).toBe(shapePath(kind)!);
      cleanup();
    }
  });

  it("star points reshape the path; roundness rounds its corners", () => {
    const defaultD = renderShape("star")
      .querySelector("path")!
      .getAttribute("d")!;
    cleanup();
    const eightD = renderShape("star", { points: 8 })
      .querySelector("path")!
      .getAttribute("d")!;
    expect(eightD).not.toBe(defaultD);
    // 8 points = 16 corners = 16 line segments when sharp.
    expect(eightD.match(/L/g)).toHaveLength(15);
    cleanup();
    const roundedD = renderShape("star", { roundness: 12 })
      .querySelector("path")!
      .getAttribute("d")!;
    expect(roundedD).toContain("Q");
    expect(defaultD).not.toContain("Q");
  });

  it("an outline renders as an inside stroke, uniform at any stretch", () => {
    // `svg > path` skips the clip path's own copy inside <clipPath>.
    const path = renderShape("hexagon", { borderWidth: 4, borderColor: "#ff0000" })
      .querySelector("svg > path")!;
    // Double-width stroke clipped to the shape = borderWidth visible inside.
    expect(path.getAttribute("stroke-width")).toBe("8");
    expect(path.getAttribute("stroke")).toBe("#ff0000");
    expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(path.getAttribute("clip-path")).toMatch(/^url\(#/);
  });

  it("box kinds take adjustable roundness in cqmin (uniform on stretch)", () => {
    const square = renderShape("square", { roundness: 30 })
      .querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(square.style.borderRadius).toBe("30cqmin");
    cleanup();
    // `rounded` is born rounded: its default renders without a stored value.
    const rounded = renderShape("rounded")
      .querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(rounded.style.borderRadius).toBe("22cqmin");
    cleanup();
    // Fully-round-by-construction kinds ignore roundness entirely.
    const pill = renderShape("pill", { roundness: 30 })
      .querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(pill.style.borderRadius).toBe("");
  });

  it("falls back to muted fill when the stored color is hostile", () => {
    const path = renderShape("star", { color: "url(javascript:x)" })
      .querySelector("path")!;
    expect(path.classList.contains("fill-muted")).toBe(true);
    expect(path.getAttribute("style")).toBeNull();
  });
});
