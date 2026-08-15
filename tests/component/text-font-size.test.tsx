import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_VARIANT_BASE_PX,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";
import { TextTileContent } from "@/components/storefront/TextTileContent";

/**
 * Free-form text sizing, from both ends: the control a seller drives, and what
 * the tile renders. The five-preset select is gone: any size in range is
 * reachable, and "Auto" (follow the style) stays a state of its own rather than
 * becoming a number the seller has to remember.
 */

afterEach(cleanup);

const THEME: StorefrontTheme = DEFAULT_STOREFRONT_CONFIG.theme;

function block(over: Partial<TextBlock> = {}): TextBlock {
  return {
    type: "text",
    id: "00000000-0000-4000-8000-000000000001",
    text: "Hello",
    variant: "heading",
    align: "left",
    x: 0,
    y: 0,
    w: 2,
    h: 1,
    ...over,
  };
}

function renderEditor(over: Partial<TextBlock> = {}) {
  const onUpdate = vi.fn();
  render(
    <TextBlockEditor
      block={block(over)}
      accent="#171717"
      onUpdate={onUpdate}
      onDuplicate={vi.fn()}
    />,
  );
  return { onUpdate };
}

describe("TextBlockEditor: size", () => {
  it("offers the whole range, not five presets", () => {
    renderEditor();
    const slider = screen.getByRole("slider", { name: "Font size" });
    expect(slider).toHaveAttribute("aria-valuemin", String(TEXT_SIZE_MIN));
    expect(slider).toHaveAttribute("aria-valuemax", String(TEXT_SIZE_MAX));
    // No "Small/Medium/Large" select left behind.
    expect(
      screen.queryByRole("combobox", { name: "Size" }),
    ).not.toBeInTheDocument();
  });

  it("starts on Auto, showing what the block's style renders at", () => {
    renderEditor({ variant: "body" });
    expect(
      screen.getByText(`Auto (${TEXT_VARIANT_BASE_PX.body} px)`),
    ).toBeInTheDocument();
    // Auto is not a stored size, so there is nothing to reset yet.
    expect(screen.queryByRole("button", { name: "Auto" })).not.toBeInTheDocument();
  });

  it("types an exact size", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor();
    const field = screen.getByLabelText("Size");
    await user.clear(field);
    await user.type(field, "42");
    expect(onUpdate).toHaveBeenLastCalledWith({ fontSize: 42 });
  });

  it("nudges the slider off the variant's own size", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor({ variant: "heading" });
    const slider = screen.getByRole("slider", { name: "Font size" });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onUpdate).toHaveBeenCalledWith({
      fontSize: TEXT_VARIANT_BASE_PX.heading + 1,
    });
  });

  it("clamps a typed size into range rather than storing it", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor({ fontSize: 20 });
    const field = screen.getByLabelText("Size");
    await user.clear(field);
    await user.type(field, "9999");
    await user.tab();
    expect(onUpdate).toHaveBeenLastCalledWith({ fontSize: TEXT_SIZE_MAX });
  });

  it("goes back to Auto in one press, clearing the stored size", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor({ fontSize: 64 });
    await user.click(screen.getByRole("button", { name: "Auto" }));
    expect(onUpdate).toHaveBeenCalledWith({ fontSize: undefined });
  });
});

describe("TextTileContent: size", () => {
  it("renders a stored size as px, keeping the variant's weight", () => {
    const { container } = render(
      <TextTileContent block={block({ fontSize: 47 })} theme={THEME} />,
    );
    const paragraph = within(container).getByText("Hello");
    expect(paragraph).toHaveStyle({ fontSize: "47px" });
    // The variant still supplies the weight, so heading/body stay distinct.
    expect(paragraph.className).toContain("font-semibold");
    // ...and its own text-size class is gone, or it would fight the px value.
    expect(paragraph.className).not.toContain("text-xl");
  });

  it("leaves sizing to the variant's classes when there is no override", () => {
    const { container } = render(
      <TextTileContent block={block()} theme={THEME} />,
    );
    const paragraph = within(container).getByText("Hello");
    expect(paragraph.style.fontSize).toBe("");
    expect(paragraph.className).toContain("text-xl");
  });
});
