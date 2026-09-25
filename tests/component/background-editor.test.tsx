import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, within } from "../setup/render";
import { english } from "../setup/translate";
import { BackgroundEditor } from "@/components/storefront/BackgroundEditor";
import { ToastProvider } from "@/components/ui/Toast";
import { themeAccentPresets } from "@/lib/theme/theme-color-presets";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";
import type { StorefrontBackground } from "@/types/storefront";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; the Popover underneath the
// color field reads it. Same stub as color-picker.test.tsx.
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

const ACCENT = "#a855f7";
const SOLID: StorefrontBackground = { kind: "solid", color: "#ffffff" };

function mount(accent = ACCENT) {
  return render(
    <ToastProvider>
      <BackgroundEditor
        value={SOLID}
        onChange={vi.fn()}
        imageUrl={null}
        onImageChange={vi.fn()}
        accent={accent}
      />
    </ToastProvider>,
  );
}

/** The solid color field's swatch row specifically — the tab strip above it
 *  ("Color" / "Gradient" / "Image") also has a button named "Color". */
function colorSwatchRow() {
  return screen.getByRole("group", { name: /color swatches/i });
}

describe("BackgroundEditor solid color quick picks", () => {
  it("offers the theme's own accent presets, not the generic neutrals", () => {
    mount();
    const row = colorSwatchRow();
    for (const preset of themeAccentPresets(ACCENT)) {
      expect(
        within(row).getByRole("button", { name: english(preset.label, { value: preset.value }) }),
      ).toBeInTheDocument();
    }
    // The three neutrals every other field shares are NOT here — this field
    // shows the seller's own brand color instead.
    for (const preset of COLOR_PRESETS) {
      expect(
        within(row).queryByRole("button", { name: english(preset.label, { value: preset.value }) }),
      ).toBeNull();
    }
  });

  it("changing the theme's accent changes the quick picks", () => {
    const { rerender } = render(
      <ToastProvider>
        <BackgroundEditor
          value={SOLID}
          onChange={vi.fn()}
          imageUrl={null}
          onImageChange={vi.fn()}
          accent="#16a34a"
        />
      </ToastProvider>,
    );
    const greenPreset = themeAccentPresets("#16a34a")[2];
    expect(
      within(colorSwatchRow()).getByRole("button", {
        name: english(greenPreset.label, { value: greenPreset.value }),
      }),
    ).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <BackgroundEditor
          value={SOLID}
          onChange={vi.fn()}
          imageUrl={null}
          onImageChange={vi.fn()}
          accent={ACCENT}
        />
      </ToastProvider>,
    );
    const purplePreset = themeAccentPresets(ACCENT)[2];
    expect(
      within(colorSwatchRow()).getByRole("button", {
        name: english(purplePreset.label, { value: purplePreset.value }),
      }),
    ).toBeInTheDocument();
    expect(
      within(colorSwatchRow()).queryByRole("button", {
        name: english(greenPreset.label, { value: greenPreset.value }),
      }),
    ).toBeNull();
  });
});
