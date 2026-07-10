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

/** Open the ColorPicker popover and return the hex input element. */
async function openPickerAndGetHexInput(
  onChange: (hex: string) => void,
  value = "#a855f7",
) {
  const user = userEvent.setup();
  render(<ColorPicker value={value} onChange={onChange} label="Color" />);
  await user.click(screen.getByTestId("color-picker-trigger"));
  return { user, hexInput: screen.getByRole("textbox", { name: /hex color/i }) };
}

// ---------------------------------------------------------------------------
// ColorPicker — hex text input
// ---------------------------------------------------------------------------

describe("ColorPicker hex input", () => {
  it("typing a valid hex calls onChange with lowercase strict hex", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPickerAndGetHexInput(onChange);
    await user.clear(hexInput);
    await user.type(hexInput, "#FF0000");
    expect(onChange).toHaveBeenLastCalledWith("#ff0000");
    expect(onChange.mock.calls.every(([v]) => STRICT_HEX.test(v))).toBe(true);
  });

  it("typing an uppercase valid hex normalises to lowercase", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPickerAndGetHexInput(onChange);
    await user.clear(hexInput);
    await user.type(hexInput, "#ABCDEF");
    expect(onChange).toHaveBeenLastCalledWith("#abcdef");
  });

  it("typing invalid text does NOT call onChange", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPickerAndGetHexInput(onChange);
    await user.clear(hexInput);
    // Each character typed while invalid must NOT trigger onChange.
    onChange.mockClear(); // discard the initial clear's events if any
    await user.type(hexInput, "garbage");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("error message and aria-invalid appear while input is invalid", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPickerAndGetHexInput(onChange);
    await user.clear(hexInput);
    await user.type(hexInput, "zzz");
    expect(hexInput).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/6-digit hex color/i),
    ).toBeInTheDocument();
  });

  it("blur with invalid value snaps back to last valid value", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPickerAndGetHexInput(
      onChange,
      "#a855f7",
    );
    await user.clear(hexInput);
    await user.type(hexInput, "notahex");
    // Blur the input.
    await user.tab();
    // Input should display the last valid prop value.
    expect(hexInput).toHaveValue("#a855f7");
    // Error should be gone.
    expect(hexInput).not.toHaveAttribute("aria-invalid");
    expect(
      screen.queryByText(/6-digit hex color/i),
    ).not.toBeInTheDocument();
  });

  it("onChange NEVER emits values outside strict hex pattern", async () => {
    const onChange = vi.fn();
    const { user, hexInput } = await openPickerAndGetHexInput(
      onChange,
      "#171717",
    );
    // Type partially-valid values that should never propagate.
    await user.clear(hexInput);
    await user.type(hexInput, "#ggg");
    // All emitted values (from preset clicks, area, etc.) must be strict hex.
    onChange.mock.calls.forEach(([v]) => {
      expect(v).toMatch(STRICT_HEX);
    });
  });
});

// ---------------------------------------------------------------------------
// ColorPicker — preset swatches
// ---------------------------------------------------------------------------

describe("ColorPicker presets", () => {
  it("preset swatches are rendered", async () => {
    const user = userEvent.setup();
    render(<ColorPicker value="#a855f7" onChange={vi.fn()} label="Color" />);
    await user.click(screen.getByTestId("color-picker-trigger"));
    // Should find all 12 preset buttons.
    const group = screen.getByRole("group", { name: /color presets/i });
    expect(group.querySelectorAll("button")).toHaveLength(COLOR_PRESETS.length);
  });

  it("clicking a preset calls onChange with that preset hex", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value="#a855f7" onChange={onChange} label="Color" />);
    await user.click(screen.getByTestId("color-picker-trigger"));

    const preset = COLOR_PRESETS[3]; // Red (#ef4444)
    const group = screen.getByRole("group", { name: /color presets/i });
    await user.click(within(group).getByRole("button", { name: new RegExp(preset.name, "i") }));
    expect(onChange).toHaveBeenLastCalledWith(preset.value);
  });

  it("active preset has aria-pressed=true", async () => {
    const activePreset = COLOR_PRESETS[0]; // Ink (#171717)
    const user = userEvent.setup();
    render(
      <ColorPicker value={activePreset.value} onChange={vi.fn()} label="Color" />,
    );
    await user.click(screen.getByTestId("color-picker-trigger"));
    // Use the full aria-label to be unambiguous.
    const presetBtn = screen.getByRole("button", {
      name: `${activePreset.name} (${activePreset.value})`,
    });
    expect(presetBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("non-active presets have aria-pressed=false", async () => {
    const user = userEvent.setup();
    render(<ColorPicker value="#a855f7" onChange={vi.fn()} label="Color" />);
    await user.click(screen.getByTestId("color-picker-trigger"));
    const group = screen.getByRole("group", { name: /color presets/i });
    const presetBtns = within(group).getAllByRole("button");
    const notActive = presetBtns.filter((b) => b.getAttribute("aria-pressed") !== "true");
    expect(notActive.length).toBeGreaterThan(0);
    notActive.forEach((btn) => {
      expect(btn).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("preset onChange always emits strict hex", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker value="#a855f7" onChange={onChange} label="Color" />);
    await user.click(screen.getByTestId("color-picker-trigger"));
    // Click all preset buttons by their full aria-label to avoid ambiguity.
    for (const preset of COLOR_PRESETS) {
      const btn = screen.getByRole("button", {
        name: `${preset.name} (${preset.value})`,
      });
      await user.click(btn);
    }
    onChange.mock.calls.forEach(([v]) => {
      expect(v).toMatch(STRICT_HEX);
    });
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
    expect(
      screen.getByRole("slider", { name: /hue/i }),
    ).toBeInTheDocument();
  });

  it("SV ArrowRight increases saturation by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    fireEvent.keyDown(sv, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 52, v: 50 });
  });

  it("SV ArrowLeft decreases saturation by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    fireEvent.keyDown(sv, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 48, v: 50 });
  });

  it("SV ArrowUp increases brightness by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    fireEvent.keyDown(sv, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 50, v: 52 });
  });

  it("SV ArrowDown decreases brightness by 2", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    fireEvent.keyDown(sv, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 50, v: 48 });
  });

  it("SV Shift+ArrowRight steps by 10", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    fireEvent.keyDown(sv, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 60, v: 50 });
  });

  it("SV saturation clamps at 100", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 180, s: 98, v: 50 }} onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    fireEvent.keyDown(sv, { key: "ArrowRight", shiftKey: true }); // +10 → 108 → clamped to 100
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 100, v: 50 });
  });

  it("SV saturation clamps at 0", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 180, s: 1, v: 50 }} onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    fireEvent.keyDown(sv, { key: "ArrowLeft", shiftKey: true }); // -10 → -9 → clamped to 0
    expect(onChange).toHaveBeenCalledWith({ h: 180, s: 0, v: 50 });
  });

  it("SV aria-valuenow reflects saturation", () => {
    render(<ColorArea hsv={{ h: 0, s: 75, v: 50 }} onChange={vi.fn()} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    expect(sv).toHaveAttribute("aria-valuenow", "75");
  });

  it("SV aria-valuetext describes saturation and brightness", () => {
    render(<ColorArea hsv={{ h: 0, s: 75, v: 60 }} onChange={vi.fn()} />);
    const sv = screen.getByRole("slider", { name: /saturation and brightness/i });
    expect(sv).toHaveAttribute(
      "aria-valuetext",
      "75% saturation, 60% brightness",
    );
  });

  it("Hue ArrowRight increases hue by 4", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const hue = screen.getByRole("slider", { name: /hue/i });
    fireEvent.keyDown(hue, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ h: 184, s: 50, v: 50 });
  });

  it("Hue ArrowLeft decreases hue by 4", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const hue = screen.getByRole("slider", { name: /hue/i });
    fireEvent.keyDown(hue, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ h: 176, s: 50, v: 50 });
  });

  it("Hue Shift+ArrowRight steps by 15", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={baseHsv} onChange={onChange} />);
    const hue = screen.getByRole("slider", { name: /hue/i });
    fireEvent.keyDown(hue, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith({ h: 195, s: 50, v: 50 });
  });

  it("Hue wraps below 0 (ArrowLeft at 0 → 356)", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 0, s: 50, v: 50 }} onChange={onChange} />);
    const hue = screen.getByRole("slider", { name: /hue/i });
    fireEvent.keyDown(hue, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ h: 356, s: 50, v: 50 });
  });

  it("Hue wraps above 360 (ArrowRight at 358 → 2)", () => {
    const onChange = vi.fn();
    render(<ColorArea hsv={{ h: 358, s: 50, v: 50 }} onChange={onChange} />);
    const hue = screen.getByRole("slider", { name: /hue/i });
    fireEvent.keyDown(hue, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ h: 2, s: 50, v: 50 });
  });

  it("Hue aria-valuenow reflects hue", () => {
    render(<ColorArea hsv={{ h: 120, s: 50, v: 50 }} onChange={vi.fn()} />);
    expect(
      screen.getByRole("slider", { name: /hue/i }),
    ).toHaveAttribute("aria-valuenow", "120");
  });

  it("Hue aria-valuetext shows degrees", () => {
    render(<ColorArea hsv={{ h: 90, s: 50, v: 50 }} onChange={vi.fn()} />);
    expect(
      screen.getByRole("slider", { name: /hue/i }),
    ).toHaveAttribute("aria-valuetext", "90 degrees");
  });
});
