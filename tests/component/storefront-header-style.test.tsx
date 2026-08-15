import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_STOREFRONT_CONFIG,
  DEFAULT_STOREFRONT_HEADER,
  EMPTY_STOREFRONT_HEADER,
  HEADER_BASE_PX,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { StorefrontMasthead } from "@/components/storefront/StorefrontMasthead";

/**
 * The masthead's two lines are styled where every other colour in the editor
 * is: the left-hand panel. Each line carries its own optional colour and size,
 * and the canvas is what aims the panel at one — so the lines have to be
 * selectable in the designer and inert everywhere else.
 */

afterEach(cleanup);

function themeWith(over: Partial<StorefrontTheme> = {}): StorefrontTheme {
  return { ...DEFAULT_STOREFRONT_CONFIG.theme, ...over };
}

function header(over: Partial<StorefrontHeader> = {}): StorefrontHeader {
  return { show: true, name: "Shop", bio: "Handmade things", ...over };
}

describe("StorefrontMasthead: colour", () => {
  it("paints each line in its own colour when one is set", () => {
    render(
      <StorefrontMasthead
        header={header({ nameColor: "#aa0000", bioColor: "#00aa00" })}
        theme={themeWith({ accent: "#123456" })}
      />,
    );
    expect(screen.getByText("Shop")).toHaveStyle({ color: "rgb(170, 0, 0)" });
    expect(screen.getByText("Handmade things")).toHaveStyle({
      color: "rgb(0, 170, 0)",
    });
  });

  it("without overrides the name follows the accent and the bio inherits", () => {
    render(
      <StorefrontMasthead header={header()} theme={themeWith({ accent: "#123456" })} />,
    );
    expect(screen.getByText("Shop")).toHaveStyle({ color: "rgb(18, 52, 86)" });
    // Body copy stays on the surrounding foreground, so a dark canvas reads
    // exactly as it did before colours were offered.
    expect(screen.getByText("Handmade things").style.color).toBe("");
  });

  it("refuses a colour that is not strict hex, whatever is in the config", () => {
    render(
      <StorefrontMasthead
        header={header({ nameColor: "red; background:url(x)", bioColor: "#FFF" })}
        theme={themeWith({ accent: "#123456" })}
      />,
    );
    // Falls back to the inherited colour rather than painting the attribute.
    expect(screen.getByText("Shop")).toHaveStyle({ color: "rgb(18, 52, 86)" });
    expect(screen.getByText("Handmade things").style.color).toBe("");
  });
});

describe("StorefrontMasthead: size", () => {
  it("renders a stored size as px, dropping the class scale", () => {
    render(
      <StorefrontMasthead
        header={header({ nameSize: 57, bioSize: 9 })}
        theme={themeWith()}
      />,
    );
    const name = screen.getByText("Shop");
    expect(name).toHaveStyle({ fontSize: "57px" });
    // The class scale would fight the px value, so it is not applied.
    expect(name.className).not.toContain("text-xl");
    expect(screen.getByText("Handmade things")).toHaveStyle({ fontSize: "9px" });
  });

  it("falls back to the line's own scale when no size is stored", () => {
    render(<StorefrontMasthead header={header()} theme={themeWith()} />);
    const name = screen.getByText("Shop");
    expect(name.style.fontSize).toBe("");
    expect(name.className).toContain("text-xl");
  });

  it("ignores a stored size in the compact preview", () => {
    // A 200px store name would fill a list card; the miniature keeps its own
    // small type whatever the storefront says.
    render(
      <StorefrontMasthead header={header({ nameSize: 200 })} theme={themeWith()} compact />,
    );
    expect(screen.getByText("Shop").style.fontSize).toBe("");
  });
});

describe("StorefrontMasthead: selecting a line", () => {
  it("is inert without a select handler, so previews stay plain text", () => {
    render(<StorefrontMasthead header={header()} theme={themeWith()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reports which line was clicked", async () => {
    const user = userEvent.setup();
    const onSelectLine = vi.fn();
    render(
      <StorefrontMasthead
        header={header()}
        theme={themeWith()}
        onSelectLine={onSelectLine}
      />,
    );
    await user.click(screen.getByRole("button", { name: /store name/i }));
    expect(onSelectLine).toHaveBeenLastCalledWith("name");
    await user.click(screen.getByRole("button", { name: /store bio/i }));
    expect(onSelectLine).toHaveBeenLastCalledWith("bio");
  });

  it("is reachable from the keyboard", async () => {
    const user = userEvent.setup();
    const onSelectLine = vi.fn();
    render(
      <StorefrontMasthead
        header={header()}
        theme={themeWith()}
        onSelectLine={onSelectLine}
      />,
    );
    screen.getByRole("button", { name: /store name/i }).focus();
    await user.keyboard("{Enter}");
    expect(onSelectLine).toHaveBeenCalledWith("name");
  });

  it("marks the line the panel is currently on", () => {
    render(
      <StorefrontMasthead
        header={header()}
        theme={themeWith()}
        activeLine="bio"
        onSelectLine={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /store name/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /store bio/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("header defaults", () => {
  it("a new storefront starts with the masthead shown and filled in", () => {
    expect(DEFAULT_STOREFRONT_HEADER.show).toBe(true);
    expect(DEFAULT_STOREFRONT_HEADER.name.trim().length).toBeGreaterThan(0);
    expect(DEFAULT_STOREFRONT_HEADER.bio.trim().length).toBeGreaterThan(0);
    expect(DEFAULT_STOREFRONT_CONFIG.header).toEqual(DEFAULT_STOREFRONT_HEADER);

    render(
      <StorefrontMasthead header={DEFAULT_STOREFRONT_HEADER} theme={themeWith()} />,
    );
    expect(screen.getByText(DEFAULT_STOREFRONT_HEADER.name)).toBeInTheDocument();
  });

  it("a config that never had a header stays blank, not filled with placeholders", () => {
    // The fallback for pre-header configs is deliberately NOT the new default:
    // a seller who never had a masthead must not find one appear over their
    // storefront because the default for new ones changed.
    expect(EMPTY_STOREFRONT_HEADER.show).toBe(false);
    const { container } = render(
      <StorefrontMasthead header={EMPTY_STOREFRONT_HEADER} theme={themeWith()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("the sizes the control calls Auto are what the lines actually render at", () => {
    render(<StorefrontMasthead header={header()} theme={themeWith()} />);
    // text-xl/sm:text-2xl and text-sm; jsdom applies no stylesheet, so this
    // pins the numbers the size control shows against the classes in use.
    expect(HEADER_BASE_PX.name).toBe(24);
    expect(HEADER_BASE_PX.bio).toBe(14);
    expect(screen.getByText("Shop").className).toContain("sm:text-2xl");
    expect(screen.getByText("Handmade things").className).toContain("text-sm");
  });
});
