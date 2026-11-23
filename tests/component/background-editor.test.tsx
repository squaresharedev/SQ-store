import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, cleanup, within } from "../setup/render";
import { BackgroundEditor } from "@/components/storefront/BackgroundEditor";
import { ToastProvider } from "@/components/ui/Toast";
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
const GRADIENT: StorefrontBackground = { kind: "gradient", from: "#111111", to: "#222222", angle: 160 };

function mount(value: StorefrontBackground = SOLID, onChange = vi.fn()) {
  render(
    <ToastProvider>
      <BackgroundEditor value={value} onChange={onChange} imageUrl={null} onImageChange={vi.fn()} accent={ACCENT} />
    </ToastProvider>,
  );
  return onChange;
}

describe("BackgroundEditor chooses the KIND of background", () => {
  it("offers color, gradient and image, with the current one pressed", () => {
    mount();
    const kinds = screen.getByRole("group", { name: "Background type" });
    expect(within(kinds).getByRole("button", { name: "Color" })).toHaveAttribute("aria-pressed", "true");
    expect(within(kinds).getByRole("button", { name: "Gradient" })).toHaveAttribute("aria-pressed", "false");
    expect(within(kinds).getByRole("button", { name: "Image" })).toHaveAttribute("aria-pressed", "false");
  });

  it("has no colour picker for a plain colour: that colour is the palette's Background swatch", () => {
    mount();
    expect(screen.queryAllByRole("group", { name: /color swatches/i })).toHaveLength(0);
    expect(screen.getByText(/Background swatch in the palette above/i)).toBeInTheDocument();
  });

  it("switches to a gradient, starting from the colour it had", async () => {
    const onChange = mount();
    await userEvent.setup().click(screen.getByRole("button", { name: "Gradient" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ kind: "gradient" });
  });

  it("switches a gradient back to a colour", async () => {
    const onChange = mount(GRADIENT);
    await userEvent.setup().click(within(screen.getByRole("group", { name: "Background type" })).getByRole("button", { name: "Color" }));
    expect(onChange.mock.calls[0][0]).toEqual({ kind: "solid", color: "#111111" });
  });

  it("keeps a gradient's own stops reachable (the palette has no gradient stops)", () => {
    mount(GRADIENT);
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
    expect(screen.queryByText(/Background swatch in the palette above/i)).toBeNull();
  });
});
