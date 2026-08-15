import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorPanel } from "@/components/storefront/ColorPanel";
import { STANDARD_COLOR_ROWS } from "@/lib/theme/standard-colors";
import { COLOR_PALETTES } from "@/lib/theme/color-palettes";
import {
  __resetRecentColors,
  getRecentColors,
  recordRecentColor,
} from "@/lib/theme/recent-colors";
import type { ResolvedColorTarget } from "@/lib/theme/color-target";

const STRICT_HEX = /^#[0-9a-f]{6}$/;

// jsdom does not implement matchMedia; CollapsibleSection's chrome is fine
// without it, but Popover-adjacent code paths read it.
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

// The recents store is module scope on purpose, so one test's picks would
// otherwise be the next one's starting state.
afterEach(() => {
  cleanup();
  __resetRecentColors();
});

const FILL: ResolvedColorTarget = { label: "Fill", value: "#123456" };

function renderPanel(over: Partial<Parameters<typeof ColorPanel>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <ColorPanel
      target={FILL}
      inDesign={[]}
      onPick={onPick}
      onClose={onClose}
      {...over}
    />,
  );
  return { onPick, onClose };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("ColorPanel header", () => {
  it("names the field it is editing and shows its hex", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Fill" })).toBeInTheDocument();
    expect(screen.getByText("#123456")).toBeInTheDocument();
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.click(screen.getByRole("button", { name: /close color panel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

describe("ColorPanel sections", () => {
  it("renders the standard grid, every swatch, in one group", () => {
    renderPanel();
    const group = screen.getByRole("group", { name: /standard colors/i });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(STANDARD_COLOR_ROWS.flat().length);
  });

  it("renders every palette as its own labelled group", () => {
    renderPanel();
    for (const palette of COLOR_PALETTES) {
      const group = screen.getByRole("group", {
        name: new RegExp(`${palette.name} palette`, "i"),
      });
      expect(within(group).getAllByRole("button")).toHaveLength(
        palette.colors.length,
      );
    }
  });

  it("shows the colors already in the design", () => {
    renderPanel({ inDesign: ["#aa0000", "#00aa00"] });
    const group = screen.getByRole("group", { name: /colors in this design/i });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    expect(
      within(group).getByRole("button", { name: "In this design (#aa0000)" }),
    ).toBeInTheDocument();
  });

  it("explains itself rather than showing an empty design section", () => {
    renderPanel({ inDesign: [] });
    expect(screen.queryByRole("group", { name: /colors in this design/i })).toBeNull();
    expect(screen.getByText(/collect here/i)).toBeInTheDocument();
  });

  it("has no recents section until something has been picked", () => {
    renderPanel();
    expect(screen.queryByRole("group", { name: /recently used/i })).toBeNull();
  });

  it("shows recents once there are some", () => {
    recordRecentColor("#abcdef");
    renderPanel();
    const group = screen.getByRole("group", { name: /recently used colors/i });
    expect(
      within(group).getByRole("button", { name: "Recently used (#abcdef)" }),
    ).toBeInTheDocument();
  });

  it("the custom section is collapsed until asked for", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.queryByRole("textbox", { name: /hex color/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("textbox", { name: /hex color/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

describe("ColorPanel typography", () => {
  // The masthead's lines have no tile and no inspector card, so this panel is
  // the whole of their styling: everything a text block gets from its
  // inspector card, they get here.
  const typography = () => ({
    size: undefined,
    autoSize: 24,
    onSizeChange: vi.fn(),
    font: undefined,
    hasCustomFont: false,
    onFontChange: vi.fn(),
    bold: false,
    italic: false,
    underline: false,
    onFormatToggle: vi.fn(),
    align: "left" as const,
    onAlignChange: vi.fn(),
  });

  it("has no size control for a field that is only a colour", () => {
    renderPanel();
    expect(
      screen.queryByRole("slider", { name: /font size/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bold" })).not.toBeInTheDocument();
  });

  it("offers a size control for a field that carries one", () => {
    renderPanel({ typography: typography() });
    expect(screen.getByRole("slider", { name: /font size/i })).toBeInTheDocument();
    // Following the line's own scale is a state, not a number to remember.
    expect(screen.getByText("Auto (24 px)")).toBeInTheDocument();
  });

  it("reports a typed size to the field that owns it", async () => {
    const user = userEvent.setup();
    const control = typography();
    renderPanel({ typography: control });
    const field = screen.getByLabelText("Size");
    await user.clear(field);
    await user.type(field, "48");
    expect(control.onSizeChange).toHaveBeenLastCalledWith(48);
  });

  it("clears the override rather than storing the number it was on", async () => {
    const user = userEvent.setup();
    const control = { ...typography(), size: 48 };
    renderPanel({ typography: control });
    await user.click(screen.getByRole("button", { name: "Auto" }));
    expect(control.onSizeChange).toHaveBeenCalledWith(undefined);
  });

  it("offers the same formatting, alignment and font a text block has", async () => {
    const user = userEvent.setup();
    const control = typography();
    renderPanel({ typography: control });

    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(control.onFormatToggle).toHaveBeenLastCalledWith("bold");
    await user.click(screen.getByRole("button", { name: "Italic" }));
    expect(control.onFormatToggle).toHaveBeenLastCalledWith("italic");
    await user.click(screen.getByRole("button", { name: "Align center" }));
    expect(control.onAlignChange).toHaveBeenLastCalledWith("center");
    expect(screen.getByLabelText("Font")).toBeInTheDocument();
  });

  it("shows which formatting is on, so the button IS the state", () => {
    renderPanel({ typography: { ...typography(), bold: true, align: "right" } });
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Italic" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ColorPanel picking", () => {
  it("a standard swatch emits its hex", async () => {
    const user = userEvent.setup();
    const { onPick } = renderPanel();
    const swatch = STANDARD_COLOR_ROWS[1][0];
    await user.click(
      screen.getByRole("button", { name: `${swatch.name} (${swatch.value})` }),
    );
    expect(onPick).toHaveBeenLastCalledWith(swatch.value);
  });

  it("a palette swatch emits its hex", async () => {
    const user = userEvent.setup();
    const { onPick } = renderPanel();
    const palette = COLOR_PALETTES[0];
    const swatch = palette.colors[2];
    await user.click(
      screen.getByRole("button", {
        name: `${palette.name} ${swatch.name} (${swatch.value})`,
      }),
    );
    expect(onPick).toHaveBeenLastCalledWith(swatch.value);
  });

  it("an in-design swatch emits its hex", async () => {
    const user = userEvent.setup();
    const { onPick } = renderPanel({ inDesign: ["#aa0000"] });
    await user.click(screen.getByRole("button", { name: "In this design (#aa0000)" }));
    expect(onPick).toHaveBeenLastCalledWith("#aa0000");
  });

  it("every pick is strict lowercase hex", async () => {
    const user = userEvent.setup();
    const { onPick } = renderPanel({ inDesign: ["#aa0000"] });
    for (const swatch of STANDARD_COLOR_ROWS[0]) {
      await user.click(
        screen.getByRole("button", { name: `${swatch.name} (${swatch.value})` }),
      );
    }
    expect(onPick).toHaveBeenCalled();
    onPick.mock.calls.forEach(([v]) => expect(v).toMatch(STRICT_HEX));
  });

  it("picking records the color as recent", async () => {
    const user = userEvent.setup();
    renderPanel();
    const swatch = STANDARD_COLOR_ROWS[1][3];
    await user.click(
      screen.getByRole("button", { name: `${swatch.name} (${swatch.value})` }),
    );
    expect(getRecentColors()[0]).toBe(swatch.value);
  });

  it("the swatch matching the target is the one marked pressed", () => {
    const swatch = STANDARD_COLOR_ROWS[1][0];
    renderPanel({ target: { label: "Fill", value: swatch.value } });
    expect(
      screen.getByRole("button", { name: `${swatch.name} (${swatch.value})` }),
    ).toHaveAttribute("aria-pressed", "true");
    const other = STANDARD_COLOR_ROWS[1][1];
    expect(
      screen.getByRole("button", { name: `${other.name} (${other.value})` }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

// ---------------------------------------------------------------------------
// Optional colors
// ---------------------------------------------------------------------------

describe("ColorPanel inherit", () => {
  const inheriting: ResolvedColorTarget = {
    label: "Text color",
    value: "#171717",
    inherit: { label: "Theme color", value: "#171717", active: true },
  };

  it("offers nothing to inherit on a required color", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /use theme color/i })).toBeNull();
  });

  it("offers the inherit action when the target has one", () => {
    render(
      <ColorPanel
        target={inheriting}
        inDesign={[]}
        onPick={vi.fn()}
        onInherit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /use theme color/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking inherit clears the override rather than picking a color", async () => {
    const user = userEvent.setup();
    const onInherit = vi.fn();
    const onPick = vi.fn();
    render(
      <ColorPanel
        target={inheriting}
        inDesign={[]}
        onPick={onPick}
        onInherit={onInherit}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /use theme color/i }));
    expect(onInherit).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("while inheriting, no swatch is marked active even when the hex matches", () => {
    // #171717 is in the standard grid, but there is no override to ring.
    render(
      <ColorPanel
        target={inheriting}
        inDesign={["#171717"]}
        onPick={vi.fn()}
        onInherit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "In this design (#171717)" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
