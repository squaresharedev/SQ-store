import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; provide a stub.
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
import userEvent from "@testing-library/user-event";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { ColorArea } from "@/components/ui/ColorArea";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STRICT_HEX = /^#[0-9a-f]{6}$/;

/** A hex that is deliberately NOT one of the quick swatches. */
const CUSTOM = "#a855f7";

function swatchRow() {
  return screen.getByRole("group", { name: /color swatches/i });
}

/** Open the picker panel and return the hex input inside it. */
async function openPanel(onChange: (hex: string) => void, value = CUSTOM) {
  const user = userEvent.setup();
  render(<ColorPicker value={value} onChange={onChange} label="Color" />);
  await user.click(screen.getByTestId("color-picker-trigger"));
  return { user, hexInput: screen.getByRole("textbox", { name: /hex color/i }) };
}

// ---------------------------------------------------------------------------
// The inline row — what you see before opening anything
// ---------------------------------------------------------------------------

describe("ColorPicker inline row", () => {
  it("shows the quick swatches without opening the panel", () => {
    render(<ColorPicker value={CUSTOM} onChange={vi.fn()} label="Color" />);
    const row = swatchRow();
    for (const preset of COLOR_PRESETS) {
      expect(
        within(row).getByRole("button", { name: `${preset.name} (${preset.value})` }),
      ).toBeInTheDocument();
    }
  });

  it("the panel is closed until the color wheel is clicked", async () => {
    const user = userEvent.setup();
    render(<ColorPicker value={CUSTOM} onChange={vi.fn()} label="Color" />);
    expect(screen.queryByRole("textbox", { name: /hex color/i })).toBeNull();

    await user.click(screen.getByTestId("color-picker-trigger"));
    expect(screen.getByRole("textbox", { name: /hex color/i })).toBeInTheDocument();
  });

  it("the wheel is the first control in the row", () => {
    render(<ColorPicker value={CUSTOM} onChange={vi.fn()} label="Color" />);
    const buttons = within(swatchRow()).getAllByRole("button");
    expect(buttons[0]).toBe(screen.getByTestId("color-picker-trigger"));
    expect(buttons[0]).toHaveAttribute("aria-label", "Custom color");
  });

  it("a custom color gets its own dot so the row shows what is selected", () => {
    render(<ColorPicker value={CUSTOM} onChange={vi.fn()} label="Color" />);
    const dot = within(swatchRow()).getByRole("button", {
      name: `Current color ${CUSTOM}`,
    });
    expect(dot).toHaveAttribute("aria-pressed", "true");
  });

  it("no custom dot when the value is already a quick swatch", () => {
    render(
      <ColorPicker value={COLOR_PRESETS[0].value} onChange={vi.fn()} label="Color" />,
    );
    expect(within(swatchRow()).queryByRole("button", { name: /current color/i })).toBeNull();
  });

  it("clicking the custom dot reopens the panel rather than re-emitting", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value={CUSTOM} onChange={onChange} label="Color" />);
    await user.click(screen.getByRole("button", { name: `Current color ${CUSTOM}` }));
    expect(screen.getByRole("textbox", { name: /hex color/i })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Quick swatches
// ---------------------------------------------------------------------------

describe("ColorPicker quick swatches", () => {
  it("clicking a swatch emits that hex, no panel needed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value={CUSTOM} onChange={onChange} label="Color" />);

    const preset = COLOR_PRESETS[2];
    await user.click(
      screen.getByRole("button", { name: `${preset.name} (${preset.value})` }),
    );
    expect(onChange).toHaveBeenLastCalledWith(preset.value);
  });

  it("the matching swatch is aria-pressed", () => {
    const active = COLOR_PRESETS[0];
    render(<ColorPicker value={active.value} onChange={vi.fn()} label="Color" />);
    expect(
      screen.getByRole("button", { name: `${active.name} (${active.value})` }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("every other swatch is aria-pressed=false", () => {
    const active = COLOR_PRESETS[0];
    render(<ColorPicker value={active.value} onChange={vi.fn()} label="Color" />);
    for (const preset of COLOR_PRESETS.slice(1)) {
      expect(
        screen.getByRole("button", { name: `${preset.name} (${preset.value})` }),
      ).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("every swatch emits strict hex", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value={CUSTOM} onChange={onChange} label="Color" />);
    for (const preset of COLOR_PRESETS) {
      await user.click(
        screen.getByRole("button", { name: `${preset.name} (${preset.value})` }),
      );
    }
    expect(onChange).toHaveBeenCalledTimes(COLOR_PRESETS.length);
    onChange.mock.calls.forEach(([v]) => expect(v).toMatch(STRICT_HEX));
  });
});

// ---------------------------------------------------------------------------
// Panel — hex text input
// ---------------------------------------------------------------------------

describe("ColorPicker hex input", () => {
  it("typing a valid hex calls onChange with lowercase strict hex", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPanel(onChange);
    await user.clear(hexInput);
    await user.type(hexInput, "#FF0000");
    expect(onChange).toHaveBeenLastCalledWith("#ff0000");
    expect(onChange.mock.calls.every(([v]) => STRICT_HEX.test(v))).toBe(true);
  });

  it("typing an uppercase valid hex normalises to lowercase", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPanel(onChange);
    await user.clear(hexInput);
    await user.type(hexInput, "#ABCDEF");
    expect(onChange).toHaveBeenLastCalledWith("#abcdef");
  });

  it("typing invalid text does NOT call onChange", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPanel(onChange);
    await user.clear(hexInput);
    onChange.mockClear();
    await user.type(hexInput, "garbage");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("error message and aria-invalid appear while input is invalid", async () => {
    const { user, hexInput } = await openPanel(vi.fn());
    await user.clear(hexInput);
    await user.type(hexInput, "zzz");
    expect(hexInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/6-digit hex color/i)).toBeInTheDocument();
  });

  it("blur with invalid value snaps back to last valid value", async () => {
    const { user, hexInput } = await openPanel(vi.fn(), CUSTOM);
    await user.clear(hexInput);
    await user.type(hexInput, "notahex");
    await user.tab();
    expect(hexInput).toHaveValue(CUSTOM);
    expect(hexInput).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/6-digit hex color/i)).not.toBeInTheDocument();
  });

  it("onChange NEVER emits values outside strict hex pattern", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPanel(onChange, "#171717");
    await user.clear(hexInput);
    await user.type(hexInput, "#ggg");
    onChange.mock.calls.forEach(([v]) => expect(v).toMatch(STRICT_HEX));
  });
});

// ---------------------------------------------------------------------------
// The shared "follow the theme" option
// ---------------------------------------------------------------------------

describe("ColorPicker inherit option", () => {
  function inheritProp(over: Partial<{ active: boolean; onSelect: () => void }> = {}) {
    return {
      label: "Theme color",
      value: "#3b82f6",
      active: true,
      onSelect: vi.fn(),
      ...over,
    };
  }

  it("no inherit prop renders no inherit dot", () => {
    render(<ColorPicker value={CUSTOM} onChange={vi.fn()} label="Color" />);
    expect(screen.queryByRole("button", { name: /use theme color/i })).toBeNull();
  });

  it("the inherit dot sits in the row and is pressed while inheriting", () => {
    render(
      <ColorPicker
        value="#3b82f6"
        onChange={vi.fn()}
        label="Color"
        inherit={inheritProp()}
      />,
    );
    expect(
      within(swatchRow()).getByRole("button", { name: /use theme color/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the inherit dot calls onSelect and not onChange", async () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ColorPicker
        value="#ff0000"
        onChange={onChange}
        label="Color"
        inherit={inheritProp({ active: false, onSelect })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /use theme color/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("while inheriting, no quick swatch is marked active even when the hex matches", () => {
    const preset = COLOR_PRESETS[0];
    render(
      <ColorPicker
        value={preset.value}
        onChange={vi.fn()}
        label="Color"
        inherit={inheritProp({ ...{} })}
      />,
    );
    expect(
      screen.getByRole("button", { name: `${preset.name} (${preset.value})` }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("while inheriting, no custom dot appears — there is no override to show", () => {
    render(
      <ColorPicker
        value="#3b82f6"
        onChange={vi.fn()}
        label="Color"
        inherit={inheritProp()}
      />,
    );
    expect(screen.queryByRole("button", { name: /current color/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Eyedropper (Chromium-only, so always feature detected)
// ---------------------------------------------------------------------------

describe("ColorPicker eyedropper", () => {
  afterEach(() => {
    delete (window as { EyeDropper?: unknown }).EyeDropper;
  });

  function stubEyeDropper(result: () => Promise<{ sRGBHex: string }>) {
    (window as { EyeDropper?: unknown }).EyeDropper = class {
      open() {
        return result();
      }
    };
  }

  it("is absent from the row when the browser has no EyeDropper", () => {
    render(<ColorPicker value={CUSTOM} onChange={vi.fn()} label="Color" />);
    expect(
      screen.queryByRole("button", { name: /pick a color from the screen/i }),
    ).toBeNull();
  });

  it("sits second in the row when supported", () => {
    stubEyeDropper(() => Promise.resolve({ sRGBHex: "#aabbcc" }));
    render(<ColorPicker value={CUSTOM} onChange={vi.fn()} label="Color" />);
    const buttons = within(swatchRow()).getAllByRole("button");
    expect(buttons[1]).toHaveAttribute(
      "aria-label",
      "Pick a color from the screen",
    );
  });

  it("applies the sampled color straight from the row", async () => {
    stubEyeDropper(() => Promise.resolve({ sRGBHex: "#AABBCC" }));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value={CUSTOM} onChange={onChange} label="Color" />);
    await user.click(
      within(swatchRow()).getByRole("button", {
        name: /pick a color from the screen/i,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
  });

  it("a non-hex sample is rejected rather than emitted", async () => {
    stubEyeDropper(() => Promise.resolve({ sRGBHex: "rgba(1,2,3,0.5)" }));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value={CUSTOM} onChange={onChange} label="Color" />);
    await user.click(
      within(swatchRow()).getByRole("button", {
        name: /pick a color from the screen/i,
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a cancelled pick is swallowed, not thrown", async () => {
    stubEyeDropper(() => Promise.reject(new Error("AbortError")));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value={CUSTOM} onChange={onChange} label="Color" />);
    await user.click(
      within(swatchRow()).getByRole("button", {
        name: /pick a color from the screen/i,
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ColorArea — keyboard interactions
// ---------------------------------------------------------------------------

describe("ColorArea keyboard", () => {
  const baseHsv = { h: 180, s: 50, v: 50 };

  it("saturation/brightness slider has role=slider", () => {
    render(<ColorArea hsv={baseHsv} onChange={vi.fn()} />);
    expect(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
    ).toBeInTheDocument();
  });

  it("hue slider has role=slider", () => {
    render(<ColorArea hsv={baseHsv} onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: /hue/i })).toBeInTheDocument();
  });

  it("SV ArrowRight increases saturation by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "ArrowRight" },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 52, v: 50 });
  });

  it("SV ArrowLeft decreases saturation by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "ArrowLeft" },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 48, v: 50 });
  });

  it("SV ArrowUp increases brightness by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "ArrowUp" },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 50, v: 52 });
  });

  it("SV ArrowDown decreases brightness by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "ArrowDown" },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 50, v: 48 });
  });

  it("SV Shift+ArrowRight steps by 10", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "ArrowRight", shiftKey: true },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 60, v: 50 });
  });

  it("SV saturation clamps at 100", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 180, s: 98, v: 50 }} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "ArrowRight", shiftKey: true },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 100, v: 50 });
  });

  it("SV saturation clamps at 0", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 180, s: 1, v: 50 }} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "ArrowLeft", shiftKey: true },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 0, v: 50 });
  });

  it("SV aria-valuenow reflects saturation", () => {
    render(<ColorArea hsv={{ h: 0, s: 75, v: 50 }} onChange={vi.fn()} />);
    expect(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
    ).toHaveAttribute("aria-valuenow", "75");
  });

  it("SV aria-valuetext describes saturation and brightness", () => {
    render(<ColorArea hsv={{ h: 0, s: 75, v: 60 }} onChange={vi.fn()} />);
    expect(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
    ).toHaveAttribute("aria-valuetext", "75% saturation, 60% brightness");
  });

  it("Hue ArrowRight increases hue by 4", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: /hue/i }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith({ h: 184, s: 50, v: 50 });
  });

  it("Hue ArrowLeft decreases hue by 4", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: /hue/i }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenCalledWith({ h: 176, s: 50, v: 50 });
  });

  it("Hue Shift+ArrowRight steps by 15", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: /hue/i }), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(onChange).toHaveBeenCalledWith({ h: 195, s: 50, v: 50 });
  });

  it("Hue wraps below 0 (ArrowLeft at 0 → 356)", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 0, s: 50, v: 50 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: /hue/i }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenCalledWith({ h: 356, s: 50, v: 50 });
  });

  it("Hue wraps above 360 (ArrowRight at 358 → 2)", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 358, s: 50, v: 50 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: /hue/i }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith({ h: 2, s: 50, v: 50 });
  });

  it("Hue aria-valuenow reflects hue", () => {
    render(<ColorArea hsv={{ h: 120, s: 50, v: 50 }} onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: /hue/i })).toHaveAttribute(
      "aria-valuenow",
      "120",
    );
  });

  it("Hue aria-valuetext shows degrees", () => {
    render(<ColorArea hsv={{ h: 90, s: 50, v: 50 }} onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: /hue/i })).toHaveAttribute(
      "aria-valuetext",
      "90 degrees",
    );
  });

  it("SV Home drops saturation to 0", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "Home" },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 0, v: 50 });
  });

  it("SV End raises saturation to 100", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: /saturation and brightness/i }),
      { key: "End" },
    );
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 100, v: 50 });
  });

  it("Hue Home/End jump to the ends of the spectrum", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const hue = screen.getByRole("slider", { name: /hue/i });
    fireEvent.keyDown(hue, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith({ h: 0, s: 50, v: 50 });
    fireEvent.keyDown(hue, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith({ h: 359, s: 50, v: 50 });
  });
});
