import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "../setup/render";
import { ShapeTileContent } from "@/components/storefront/ShapeTileContent";
import { ShapeBlockEditor } from "@/components/storefront/ShapeBlockEditor";
import { BackgroundEditor } from "@/components/storefront/BackgroundEditor";
import { paletteGradients } from "@/lib/storefront/gradients";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";
import { english } from "../setup/translate";
import {
  NEW_STOREFRONT_THEME,
  type GradientFill,
  type ShapeBlock,
  type ShapeKind,
  type StorefrontBackground,
} from "@/types/storefront";

afterEach(cleanup);

// The colour field's popover reads matchMedia, which jsdom lacks.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const PALETTE = NEW_STOREFRONT_THEME.palette!;
const GRADIENT: GradientFill = { from: "#fbbf24", via: "#f97316", to: "#9a3412", angle: 135 };

function shape(kind: ShapeKind, over: Partial<ShapeBlock> = {}): ShapeBlock {
  return { type: "shape", id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kind, color: "#171717", x: 0, y: 0, w: 2, h: 1, ...over };
}

function face(block: ShapeBlock) {
  const { container } = render(<ShapeTileContent block={block} />);
  // The face's wrapper is the tile's size container; the shape is inside it.
  return container.querySelector('[class*="container-type:size"]')!.firstElementChild as HTMLElement;
}

describe("a shape's gradient fill", () => {
  it("paints a box kind with the gradient instead of its colour", () => {
    const box = face(shape("square", { gradient: GRADIENT }));
    // jsdom spells the stops as rgb(); three of them, at the stored angle.
    expect(box.style.backgroundImage).toBe(
      "linear-gradient(135deg, rgb(251, 191, 36), rgb(249, 115, 22), rgb(154, 52, 18))",
    );
    expect(box.style.backgroundColor).toBe("");
  });

  it("paints a box with an outline inside the outline", () => {
    const plate = face(shape("rounded", { gradient: GRADIENT, borderWidth: 4, borderColor: "#000000" }));
    const fill = plate.querySelector("span") as HTMLElement;
    expect(fill.style.backgroundImage).toContain("linear-gradient(135deg");
  });

  it("fills a path kind through an SVG gradient running the CSS way", () => {
    const svg = face(shape("star", { gradient: GRADIENT }));
    const gradient = svg.querySelector("linearGradient")!;
    expect(gradient.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
    expect([...gradient.querySelectorAll("stop")].map((stop) => stop.getAttribute("stop-color"))).toEqual([
      "#fbbf24",
      "#f97316",
      "#9a3412",
    ]);
    expect(gradient.getAttribute("x1")).toBe("0");
    expect(gradient.getAttribute("y2")).toBe("100");
    const path = svg.querySelector("path:not(clipPath path)") as SVGPathElement;
    expect(path.style.fill).toContain(`#${gradient.id}`);
  });

  it("strokes a ring in the gradient, cut to the ring by a mask", () => {
    const ring = face(shape("ring", { gradient: GRADIENT }));
    expect(ring.style.backgroundImage).toContain("linear-gradient(135deg");
    expect(ring.style.borderColor).toBe("transparent");
  });

  it("draws exactly as before without one, or with a stop that fails the hex gate", () => {
    for (const block of [shape("square"), shape("square", { gradient: { from: "red", to: "#000000", angle: 0 } })]) {
      const box = face(block);
      expect(box.style.backgroundImage).toBe("");
      expect(box.style.backgroundColor).toBe("rgb(23, 23, 23)");
      cleanup();
    }
    const svg = face(shape("star"));
    expect(svg.querySelector("linearGradient")).toBeNull();
  });
});

describe("the shape inspector's gradient choice", () => {
  it("offers the palette's ready-made fills and paints the shape in one", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <ShapeBlockEditor block={shape("circle")} palette={PALETTE} onUpdate={onUpdate} onDuplicate={vi.fn()} onRemove={vi.fn()} />,
    );
    const group = screen.getByRole("group", { name: "Or a gradient" });
    const offered = paletteGradients(PALETTE, "fill");
    expect(within(group).getAllByRole("button")).toHaveLength(offered.length);
    await user.click(within(group).getAllByRole("button")[0]);
    expect(onUpdate).toHaveBeenCalledWith({ gradient: offered[0].fill, color: offered[0].fill.from });
  });

  it("marks the gradient worn now, and a colour pick takes it off", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const worn = paletteGradients(PALETTE, "fill")[1].fill;
    render(
      <ShapeBlockEditor
        block={shape("circle", { gradient: worn, color: worn.from })}
        palette={PALETTE}
        onUpdate={onUpdate}
        onDuplicate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const pressed = within(screen.getByRole("group", { name: "Or a gradient" }))
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    const swatches = screen.getAllByRole("group", { name: / swatches$/ })[0];
    const preset = COLOR_PRESETS[0];
    await user.click(within(swatches).getByRole("button", { name: english(preset.label, { value: preset.value }) }));
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ gradient: undefined }));
  });

  it("has no gradient choice where no palette is handed in", () => {
    render(<ShapeBlockEditor block={shape("circle")} onUpdate={vi.fn()} onDuplicate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Or a gradient" })).toBeNull();
  });
});

describe("the background's gradients", () => {
  const SOLID: StorefrontBackground = { kind: "solid", color: PALETTE.background };

  it("starts a gradient as the palette's first ready-made", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <BackgroundEditor value={SOLID} onChange={onChange} imageUrl={null} onImageChange={vi.fn()} accent={PALETTE.accent} palette={PALETTE} />,
    );
    await user.click(screen.getByRole("button", { name: "Gradient" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "gradient", ...paletteGradients(PALETTE, "backdrop")[0].fill });
  });

  it("offers ready-mades first and keeps the colours one by one behind Custom", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ready = paletteGradients(PALETTE, "backdrop");
    const value: StorefrontBackground = { kind: "gradient", ...ready[0].fill };
    const { container } = render(
      <BackgroundEditor value={value} onChange={onChange} imageUrl={null} onImageChange={vi.fn()} accent={PALETTE.accent} palette={PALETTE} />,
    );
    const group = screen.getByRole("group", { name: "Ready-made gradients" });
    expect(within(group).getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getAllByRole("button")[1]);
    expect(onChange).toHaveBeenCalledWith({ kind: "gradient", ...ready[1].fill });
    // A ready-made is worn, so Custom starts folded.
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("opens Custom for a gradient made by hand", () => {
    const { container } = render(
      <BackgroundEditor
        value={{ kind: "gradient", from: "#123456", to: "#abcdef", angle: 45 }}
        onChange={vi.fn()}
        imageUrl={null}
        onImageChange={vi.fn()}
        accent={PALETTE.accent}
        palette={PALETTE}
      />,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});
