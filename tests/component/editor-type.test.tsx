import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "../setup/render";
import { TextTileContent } from "@/components/storefront/TextTileContent";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";
import { TypographySection } from "@/components/storefront/TypographySection";
import { ColorPanel } from "@/components/storefront/ColorPanel";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { storefrontSurface } from "@/components/storefront-page/StorefrontBoard";
import { resolveInk } from "@/components/product-page/product-page-maps";
import { ColorTargetProvider, type ColorTargetContextValue } from "@/lib/theme/color-context";
import { FONT_ROLE_VARS } from "@/lib/theme/font-roles";
import { paletteSwatches } from "@/lib/theme/palette-swatches";
import type { ResolvedColorTarget } from "@/lib/theme/color-target";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontPalette, type StorefrontTheme, type TextBlock } from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";

// THE TYPE, COLOR AND TEXT WORKSTREAM, rendered: what a text block draws with
// and without saved styles, a pairing and vertical alignment; the board's
// root; and the editor's palette-first pickers.

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
afterEach(cleanup);

const THEME: StorefrontTheme = { ...DEFAULT_STOREFRONT_CONFIG.theme, accent: "#7c2d12" };
const PALETTE: StorefrontPalette = {
  background: "#f3eee6",
  text: "#1f1b16",
  accent: "#9a3412",
  surface: "#ffffff",
  muted: "#e6dccd",
};

function block(over: Partial<TextBlock> = {}): TextBlock {
  return {
    type: "text",
    id: "00000000-0000-4000-8000-000000000001",
    text: "Příliš žluťoučký kůň",
    variant: "heading",
    align: "left",
    x: 0,
    y: 0,
    w: 2,
    h: 1,
    ...over,
  };
}

function drawText(over: Partial<TextBlock> = {}, theme: Partial<StorefrontTheme> = {}) {
  const { container } = render(<TextTileContent block={block(over)} theme={{ ...THEME, ...theme }} />);
  const paragraph = within(container).getByText(over.text ?? "Příliš žluťoučký kůň");
  return { box: container.firstElementChild as HTMLElement, paragraph };
}

describe("a text block with none of the new fields", () => {
  it("draws exactly as before: centred, the variant's weight, the accent, no face of its own", () => {
    const { box, paragraph } = drawText();
    expect(box.className).toBe(
      "flex min-h-0 flex-1 flex-col justify-center overflow-hidden whitespace-pre-line p-3 text-left",
    );
    expect(box.getAttribute("style")).toBeNull();
    expect(paragraph.className).toBe("font-semibold");
    expect(paragraph).toHaveStyle({ color: "#7c2d12" });
    expect(paragraph.style.letterSpacing).toBe("");
  });
});

describe("vertical alignment", () => {
  it("puts the words at the top or the bottom, and leaves the middle as it was", () => {
    expect(drawText({ valign: "top" }).box).toHaveClass("justify-start");
    expect(drawText({ valign: "bottom" }).box).toHaveClass("justify-end");
    const middle = drawText({ valign: "middle" }).box;
    expect(middle).toHaveClass("justify-center");
    expect(middle).not.toHaveClass("justify-start");
  });
});

describe("saved text styles", () => {
  const styles = {
    label: { uppercase: true, letterSpacing: 20, color: "#9a3412", bold: true, italic: true },
    body: { bold: false, lineHeight: 170 },
  };

  it("dress a block in its style: caps, weight, slant, spacing and colour", () => {
    const { paragraph } = drawText({ variant: "label" }, { textStyles: styles });
    expect(paragraph).toHaveClass("uppercase", "font-bold", "italic");
    expect(paragraph).not.toHaveClass("font-medium");
    expect(paragraph).toHaveStyle({ letterSpacing: "0.2em", color: "#9a3412" });
  });

  it("let a block's own colour and spacing win over its style's", () => {
    const { paragraph } = drawText({ variant: "label", color: "#000000", letterSpacing: 4 }, { textStyles: styles });
    expect(paragraph).toHaveStyle({ color: "#000000", letterSpacing: "0.04em" });
  });

  it("can make a style lighter than its variant", () => {
    const { paragraph } = drawText({ variant: "body" }, { textStyles: styles });
    expect(paragraph).toHaveClass("font-normal");
    expect(paragraph).toHaveStyle({ lineHeight: "1.7" });
  });
});

describe("a font pairing on a text block", () => {
  it("sets a headline in the headline face and body text in the body face", () => {
    const heading = drawText({}, { fontPairing: "editorial" }).box;
    expect(heading.style.fontFamily).toBe(`var(${FONT_ROLE_VARS.heading}, inherit)`);
    const body = drawText({ variant: "body" }, { fontPairing: "editorial" }).box;
    expect(body.style.fontFamily).toBe(`var(${FONT_ROLE_VARS.body}, inherit)`);
  });

  it("follows the style's own face, and a block's own font wins over both", () => {
    const swapped = drawText({}, { fontPairing: "classic", textStyles: { heading: { font: "body" } } }).box;
    expect(swapped.style.fontFamily).toBe(`var(${FONT_ROLE_VARS.body}, inherit)`);
    const own = drawText({ font: "serif" }, { fontPairing: "classic" }).box;
    expect(own).toHaveClass("font-serif");
    expect(own.style.fontFamily).toBe("");
  });
});

describe("the buyer's board root", () => {
  function page(theme: Partial<StorefrontTheme>): StorefrontPageData {
    return {
      id: "p",
      name: "Shop",
      theme: { ...THEME, ...theme },
      blocks: [],
      products: [],
      tileLook: {} as StorefrontPageData["tileLook"],
      imageUrls: {},
      backgroundImageUrl: null,
      customFontUrl: null,
      seller: { businessName: "", address: "", email: "", country: "CZ" },
      allowIndexing: false,
      url: "#",
    };
  }

  it("is unchanged by this work when the storefront has no pairing and no palette", () => {
    const surface = storefrontSurface(page({ font: "serif" }));
    expect(surface.className).toBe("wrap-anywhere font-serif");
    expect(surface.ink).toBe(resolveInk(THEME));
    expect(Object.keys(surface.style).some((key) => key.startsWith("--ss-font"))).toBe(false);
  });

  it("declares the pairing's faces and role variables, and reads in the palette's Text colour", () => {
    const surface = storefrontSurface(
      page({ fontPairing: "studio", palette: PALETTE, background: { kind: "solid", color: PALETTE.background } }),
    );
    expect(surface.className).toContain("__variable--font-pair-instrument-serif");
    expect(surface.className).toContain("__variable--font-pair-manrope");
    expect(surface.style).toHaveProperty(FONT_ROLE_VARS.heading);
    expect(surface.style).toHaveProperty(FONT_ROLE_VARS.body);
    expect(surface.ink).toBe(PALETTE.text);
    expect(surface.style.color).toBe(PALETTE.text);
  });
});

function provider(over: Partial<ColorTargetContextValue> = {}): ColorTargetContextValue {
  return { activeRef: null, open: vi.fn(), close: vi.fn(), palette: PALETTE, paletteSwatches: paletteSwatches(PALETTE), ...over };
}

describe("palette first: the picker row", () => {
  it("offers the palette's five colours instead of the fixed neutrals", () => {
    render(
      <ColorTargetProvider value={provider()}>
        <ColorPicker label="Fill" value="#123456" onChange={vi.fn()} target={{ kind: "shape-fill", blockKey: "b" }} />
      </ColorTargetProvider>,
    );
    for (const hex of Object.values(PALETTE)) {
      expect(screen.getByRole("button", { name: new RegExp(`\\(${hex}\\)`) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^white/i })).toBeNull();
  });

  it("picks a palette colour in one tap", async () => {
    const onChange = vi.fn();
    render(
      <ColorTargetProvider value={provider()}>
        <ColorPicker label="Fill" value="#123456" onChange={onChange} target={{ kind: "shape-fill", blockKey: "b" }} />
      </ColorTargetProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: `Palette accent (${PALETTE.accent})` }));
    expect(onChange).toHaveBeenCalledWith(PALETTE.accent);
  });
});

describe("palette first: the colour panel", () => {
  const FILL: ResolvedColorTarget = { label: "Storefront.colors.fields.fill", value: "#123456" };

  it("opens on the palette, with every free colour behind All colors", async () => {
    const onPick = vi.fn();
    render(
      <ColorTargetProvider value={provider({ activeRef: { kind: "shape-fill", blockKey: "b" } })}>
        <ColorPanel target={FILL} inDesign={["#aa0000"]} onPick={onPick} onClose={vi.fn()} />
      </ColorTargetProvider>,
    );
    const palette = screen.getByRole("group", { name: "Palette colors" });
    expect(within(palette).getAllByRole("button")).toHaveLength(5);
    expect(screen.queryByRole("group", { name: /standard colors/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /colors in this design/i })).toBeNull();

    const user = userEvent.setup();
    await user.click(within(palette).getByRole("button", { name: `Palette muted (${PALETTE.muted})` }));
    expect(onPick).toHaveBeenCalledWith(PALETTE.muted);

    await user.click(screen.getByRole("button", { name: "All colors" }));
    expect(screen.getByRole("group", { name: /standard colors/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /colors in this design/i })).toBeInTheDocument();
  });

  it("gives a palette slot itself the whole panel, as it always was", () => {
    render(
      <ColorTargetProvider value={provider({ activeRef: { kind: "palette", slot: "accent" } })}>
        <ColorPanel
          target={{ label: "EditorType.panel.palette.slots.accent.name", value: PALETTE.accent }}
          inDesign={[]}
          onPick={vi.fn()}
          onClose={vi.fn()}
        />
      </ColorTargetProvider>,
    );
    expect(screen.queryByRole("group", { name: "Palette colors" })).toBeNull();
    expect(screen.getByRole("group", { name: /standard colors/i })).toBeInTheDocument();
  });

  it("does not repaint the design for re-picking a slot's own colour", async () => {
    const onPick = vi.fn();
    render(
      <ColorTargetProvider value={provider({ activeRef: { kind: "palette", slot: "accent" } })}>
        <ColorPanel
          target={{ label: "EditorType.panel.palette.slots.accent.name", value: "#1d4ed8" }}
          inDesign={["#1d4ed8"]}
          onPick={onPick}
          onClose={vi.fn()}
        />
      </ColorTargetProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "In this design (#1d4ed8)" }));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("the text block inspector", () => {
  function renderEditor(over: Partial<TextBlock> = {}) {
    const onUpdate = vi.fn();
    render(<TextBlockEditor block={block(over)} accent="#171717" onUpdate={onUpdate} onDuplicate={vi.fn()} />);
    return { onUpdate };
  }

  it("sets vertical alignment, and stores nothing for the middle", async () => {
    const { onUpdate } = renderEditor({ valign: "top" });
    const group = screen.getByRole("group", { name: "Vertical text alignment" });
    expect(within(group).getByRole("button", { name: "Align top" })).toHaveAttribute("aria-pressed", "true");
    const user = userEvent.setup();
    await user.click(within(group).getByRole("button", { name: "Align bottom" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ valign: "bottom" });
    await user.click(within(group).getByRole("button", { name: "Align middle" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ valign: undefined });
  });

  it("keeps the block's own overrides behind More until asked for", async () => {
    renderEditor();
    expect(screen.queryByRole("slider", { name: "Font size" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("slider", { name: "Font size" })).toBeInTheDocument();
  });

  it("shows them at once on a block that already carries one", () => {
    renderEditor({ fontSize: 40 });
    expect(screen.getByRole("slider", { name: "Font size" })).toBeInTheDocument();
  });
});

describe("Typography", () => {
  function renderSection(theme: Partial<StorefrontTheme> = {}) {
    const onChange = vi.fn();
    render(
      <TypographySection theme={{ ...THEME, ...theme }} onChange={onChange} fontUrl={null} onFontUrlChange={vi.fn()} />,
    );
    return { onChange };
  }

  it("leads with the five pairings, each shown by name", async () => {
    const { onChange } = renderSection({ fontPairing: "modern" });
    const group = screen.getByRole("group", { name: "Font pairings" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(within(group).getByRole("button", { name: /^Modern/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.setup().click(within(group).getByRole("button", { name: /^Studio/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fontPairing: "studio" }));
  });

  it("keeps the single font list behind More, and choosing from it turns the pairing off", async () => {
    const { onChange } = renderSection({ fontPairing: "modern" });
    expect(screen.queryByRole("combobox", { name: "One font for everything" })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("combobox", { name: "One font for everything" }));
    await user.click(screen.getByRole("option", { name: /Montserrat/ }));
    const next = onChange.mock.lastCall?.[0] as StorefrontTheme;
    expect(next.font).toBe("montserrat");
    expect(next).not.toHaveProperty("fontPairing");
  });
});
