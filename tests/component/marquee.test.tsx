import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { MarqueeTileContent } from "@/components/storefront/MarqueeTileContent";
import { MarqueeBlockEditor } from "@/components/storefront/MarqueeBlockEditor";
import { EditorSlotsContext } from "@/components/storefront/editor-slots";
import { InlineTextEditor } from "@/components/storefront/InlineTextEditor";
import { MARQUEE_HALF_MIN_CHARS, marqueeInk, marqueeTrack, newMarqueeBlock } from "@/lib/storefront/marquee";
import { DEFAULT_STOREFRONT_CONFIG, TEXT_VARIANT_BASE_PX, type MarqueeBlock } from "@/types/storefront";

afterEach(cleanup);

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

const THEME = DEFAULT_STOREFRONT_CONFIG.theme;
const STRIP: MarqueeBlock = {
  type: "marquee",
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  text: "Free delivery this week",
  x: 0,
  y: 0,
  w: 6,
  h: 1,
};

describe("marqueeTrack", () => {
  it("repeats the words until half the track outruns the widest strip", () => {
    for (const text of ["Hi", STRIP.text, "x".repeat(120)]) {
      const { copies, halfChars } = marqueeTrack(text);
      expect(halfChars).toBeGreaterThanOrEqual(MARQUEE_HALF_MIN_CHARS);
      expect(copies).toBeGreaterThanOrEqual(1);
    }
    expect(marqueeTrack("x".repeat(120)).copies).toBe(2);
  });
});

describe("marqueeInk", () => {
  it("prefers the strip's own colour, then its style's, then one that reads on the backdrop", () => {
    expect(marqueeInk({ color: "#123456" }, { color: "#abcdef" }, "#000000")).toBe("#123456");
    expect(marqueeInk({}, { color: "#abcdef" }, "#000000")).toBe("#abcdef");
    expect(marqueeInk({}, {}, "#18181b")).toBe("#ffffff");
    expect(marqueeInk({}, {}, "#fde68a")).toBe("#171717");
  });
  it("keeps the board's own ink when nothing is known, and gates every colour", () => {
    expect(marqueeInk({}, {}, undefined)).toBeUndefined();
    expect(marqueeInk({ color: "red" }, {}, undefined)).toBeUndefined();
  });
});

describe("newMarqueeBlock", () => {
  it("stores the words and the placement, nothing else", () => {
    const block = newMarqueeBlock({ x: 0, y: 2, w: 6, h: 1 }, "Hello");
    expect(Object.keys(block).sort()).toEqual(["h", "id", "text", "type", "w", "x", "y"]);
    expect(block.type).toBe("marquee");
  });
});

describe("MarqueeTileContent", () => {
  it("is read once: the words in the page once, the moving copies hidden", () => {
    const { container } = render(<MarqueeTileContent block={STRIP} theme={THEME} />);
    const strip = container.querySelector(".board-marquee") as HTMLElement;
    const track = strip.querySelector(".board-marquee-track") as HTMLElement;
    expect(track).toHaveAttribute("aria-hidden", "true");
    expect(strip.querySelector(".sr-only")?.textContent).toBe(STRIP.text);
    expect(track.querySelectorAll(".board-marquee-copy")).toHaveLength(marqueeTrack(STRIP.text).copies * 2);
    expect(track.style.getPropertyValue("--marquee-chars")).toBe(String(marqueeTrack(STRIP.text).halfChars));
  });

  it("wears the Small label style in its pairing face with nothing configured", () => {
    const { container } = render(<MarqueeTileContent block={STRIP} theme={THEME} />);
    const strip = container.querySelector(".board-marquee") as HTMLElement;
    expect(strip.style.fontSize).toBe(`${TEXT_VARIANT_BASE_PX.label}px`);
    expect(strip.style.fontFamily).toContain("--ss-font-body");
    expect(strip.dataset.speed).toBe("normal");
  });

  it("sets a saved style's words as saved, and picks an ink for the backdrop", () => {
    const theme = { ...THEME, textStyles: { heading: { size: 40, uppercase: true } } };
    const { container } = render(
      <MarqueeTileContent block={{ ...STRIP, variant: "heading", speed: "slow" }} theme={theme} backdrop="#18181b" />,
    );
    const strip = container.querySelector(".board-marquee") as HTMLElement;
    expect(strip.style.fontSize).toBe("40px");
    expect(strip.className).toContain("uppercase");
    expect(strip.style.fontFamily).toContain("--ss-font-heading");
    expect(strip.style.color).toBe("rgb(255, 255, 255)");
    expect(strip.dataset.speed).toBe("slow");
  });

  it("takes focus on a buyer's page, so a keyboard can pause it, but not on the canvas", () => {
    const { container, rerender } = render(<MarqueeTileContent block={STRIP} theme={THEME} />);
    expect(container.querySelector(".board-marquee")).toHaveAttribute("tabindex", "0");
    rerender(
      <EditorSlotsContext.Provider value={{ InlineTextEditor, MastheadLineEditor: null, computeEditRange: null }}>
        <MarqueeTileContent block={STRIP} theme={THEME} />
      </EditorSlotsContext.Provider>,
    );
    expect(container.querySelector(".board-marquee")).not.toHaveAttribute("tabindex");
  });
});

describe("MarqueeBlockEditor", () => {
  function mount(block: MarqueeBlock = STRIP) {
    const onUpdate = vi.fn();
    render(<MarqueeBlockEditor block={block} theme={THEME} onUpdate={onUpdate} onDuplicate={vi.fn()} onRemove={vi.fn()} />);
    return onUpdate;
  }

  it("writes the default speed as absent", async () => {
    const user = userEvent.setup();
    const onUpdate = mount({ ...STRIP, speed: "slow" });
    await user.click(screen.getByRole("button", { name: "Normal" }));
    expect(onUpdate).toHaveBeenCalledWith({ speed: undefined });
    await user.click(screen.getByRole("button", { name: "Slow" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ speed: "slow" });
  });

  it("never stores empty words", async () => {
    const user = userEvent.setup();
    const onUpdate = mount();
    const field = screen.getByLabelText("Words");
    await user.clear(field);
    expect(onUpdate).not.toHaveBeenCalledWith({ text: "" });
    await user.type(field, "Hi");
    expect(onUpdate).toHaveBeenLastCalledWith({ text: "Hi" });
  });
});
