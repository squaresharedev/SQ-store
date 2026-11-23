import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "../setup/render";
import { ThemePanel } from "@/components/storefront/ThemePanel";
import { PaletteRow } from "@/components/storefront/PaletteRow";
import { ToastProvider } from "@/components/ui/Toast";
import { derivePalette } from "@/lib/storefront/palette";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontTheme } from "@/types/storefront";

/**
 * THE THEME GROUP'S COLOURS ARE SET IN ONE PLACE: the palette row. The
 * separate Accent picker and the Background's colour picker are gone, so a
 * colour is never offered twice. The Background control still chooses what KIND
 * of background the board has.
 */

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

const THEME: StorefrontTheme = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  accent: "#7c2d12",
  background: { kind: "solid", color: "#f3eee6" },
};
const PHOTO = { kind: "image" as const, key: "images/u/photo.png", x: 50, y: 50, scale: 100 };
const PHOTO_URL = "https://photos.example/board.jpg";

function mountPanel(theme: StorefrontTheme, onChange = vi.fn(), imageUrl: string | null = null) {
  render(
    <ToastProvider>
      <ThemePanel theme={theme} onChange={onChange} backgroundImageUrl={imageUrl} onBackgroundImageChange={vi.fn()} />
    </ToastProvider>,
  );
  return onChange;
}

/** Type a colour into the open swatch's hex field. */
async function setHex(user: ReturnType<typeof userEvent.setup>, swatch: string, hex: string) {
  await user.click(screen.getByRole("button", { name: swatch }));
  const field = screen.getByRole("textbox", { name: /hex/i });
  await user.clear(field);
  await user.type(field, hex);
}

describe("the Theme group offers each colour once", () => {
  it("has the palette row and no colour picker of its own for the accent or a plain background", () => {
    mountPanel(THEME);
    const palette = screen.getByRole("group", { name: "Palette colors" });
    expect(within(palette).getAllByRole("button")).toHaveLength(5);
    // A full colour picker is a labelled group of swatches. None is left.
    expect(screen.queryAllByRole("group", { name: /color swatches/i })).toHaveLength(0);
    expect(screen.queryByText(/used for buttons, sale badges/i)).toBeNull();
  });

  it("still chooses the KIND of background, and says where a plain colour is set", () => {
    mountPanel(THEME);
    const kinds = screen.getByRole("group", { name: "Background type" });
    expect(within(kinds).getAllByRole("button").map((button) => button.textContent)).toEqual(["Color", "Gradient", "Image"]);
    expect(screen.getByText(/Background swatch in the palette above/i)).toBeInTheDocument();
  });

  it("keeps a gradient's own colours (the palette has no gradient stops)", async () => {
    const onChange = mountPanel(THEME);
    await userEvent.setup().click(within(screen.getByRole("group", { name: "Background type" })).getByRole("button", { name: "Gradient" }));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].background.kind).toBe("gradient");
  });
});

describe("the palette swatches do what the removed pickers did", () => {
  it("Accent sets the theme's accent (and the palette's)", async () => {
    const onChange = mountPanel(THEME);
    await setHex(userEvent.setup(), "Accent", "#0f766e");
    const next = onChange.mock.calls.at(-1)![0] as StorefrontTheme;
    expect(next.accent).toBe("#0f766e");
    expect(next.palette?.accent).toBe("#0f766e");
  });

  it("Background sets a solid background's colour (and the palette's)", async () => {
    const onChange = mountPanel(THEME);
    await setHex(userEvent.setup(), "Background", "#112233");
    const next = onChange.mock.calls.at(-1)![0] as StorefrontTheme;
    expect(next.background).toEqual({ kind: "solid", color: "#112233" });
    expect(next.palette?.background).toBe("#112233");
  });

  it("turning a stored palette's background back to a colour makes that colour the swatch", async () => {
    const stored: StorefrontTheme = { ...THEME, palette: { ...derivePalette(THEME), background: "#abcdef" } };
    const onChange = mountPanel({ ...stored, background: { kind: "gradient", from: "#111111", to: "#222222", angle: 160 } });
    await userEvent.setup().click(within(screen.getByRole("group", { name: "Background type" })).getByRole("button", { name: "Color" }));
    const next = onChange.mock.calls.at(-1)![0] as StorefrontTheme;
    expect(next.background.kind).toBe("solid");
    expect(next.palette?.background).toBe(next.background.kind === "solid" ? next.background.color : "");
  });
});

describe("a PHOTO background's swatch", () => {
  const photoTheme: StorefrontTheme = { ...THEME, background: PHOTO };

  it("is the photo itself, named so, not the stand-in colour", () => {
    mountPanel(photoTheme, vi.fn(), PHOTO_URL);
    const swatch = screen.getByRole("button", { name: "Background (your photo)" });
    expect(swatch.style.backgroundImage).toContain(PHOTO_URL);
    expect(swatch.style.backgroundSize).toBe("cover");
    // The other four stay plain colours.
    expect(screen.getByRole("button", { name: "Accent" }).style.backgroundImage).toBe("");
    expect(screen.getByText(/background is your photo/i)).toBeInTheDocument();
  });

  it("says nothing of a photo when the background is a colour", () => {
    mountPalette(THEME);
    expect(screen.queryByRole("button", { name: "Background (your photo)" })).toBeNull();
    expect(screen.queryByText(/background is your photo/i)).toBeNull();
  });

  it("offers a colour, and choosing one makes it the background, with no recolouring of the board", async () => {
    const onChange = vi.fn();
    // The accent wears the very colour a photo's palette stands in for the board.
    const standIn = derivePalette(photoTheme).background;
    mountPalette({ ...photoTheme, accent: standIn }, onChange, PHOTO_URL);
    await setHex(userEvent.setup(), "Background (your photo)", "#fedcba");
    const next = onChange.mock.calls.at(-1)![0] as StorefrontTheme;
    expect(next.background).toEqual({ kind: "solid", color: "#fedcba" });
    expect(next.palette?.background).toBe("#fedcba");
    expect(next.accent).toBe(standIn);
  });

  it("keeps the photo when any other swatch is changed", async () => {
    const onChange = vi.fn();
    mountPalette(photoTheme, onChange, PHOTO_URL);
    await setHex(userEvent.setup(), "Accent", "#0f766e");
    const next = onChange.mock.calls.at(-1)![0] as StorefrontTheme;
    expect(next.background).toEqual(PHOTO);
    expect(next.accent).toBe("#0f766e");
  });

  it("leaves a derived palette unstored until a swatch is changed", () => {
    expect(photoTheme.palette).toBeUndefined();
    const derived = derivePalette(photoTheme);
    // Text and Muted are read off the stand-in as ever: a light ink on a dark
    // photo, and a muted tone between them.
    expect(derived.text).not.toBe(derived.background);
    expect(derived.muted).not.toBe(derived.text);
  });
});

function mountPalette(theme: StorefrontTheme, onChange = vi.fn(), imageUrl: string | null = null) {
  render(<PaletteRow theme={theme} onChange={onChange} backgroundImageUrl={imageUrl} />);
  return onChange;
}
