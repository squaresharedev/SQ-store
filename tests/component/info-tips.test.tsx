import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Layers } from "lucide-react";
import { LayoutSection } from "@/components/storefront/LayoutSection";
import { SoldOutSection } from "@/components/storefront/SoldOutSection";
import { LooksSection } from "@/components/storefront/LooksSection";
import { AnalyticsSection } from "@/components/analytics/AnalyticsSection";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

afterEach(cleanup);

const theme = () => ({ ...DEFAULT_STOREFRONT_CONFIG.theme });

/**
 * The explanatory prose across the app moved from standing paragraphs into the
 * "?" beside the control it explains. Two things must hold for that to be an
 * improvement rather than just less text:
 *
 *   1. the paragraph is genuinely GONE from the resting page, and
 *   2. the answer is still there, reachable, and worth reading.
 *
 * (2) is the half that is easy to get wrong. A tip whose content is a stub is
 * WORSE than the sentence it replaced, because it also costs a click. So these
 * assert real substance, not merely that a bubble opened.
 */
async function openTip(name: string | RegExp): Promise<string> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  const text = (screen.getByRole("tooltip").textContent ?? "").trim();
  // A click PINS the bubble, so it has to be dismissed before the next one is
  // opened or getByRole("tooltip") finds two and throws.
  await user.keyboard("{Escape}");
  expect(
    text.split(/\s+/).length,
    `"${name}" is too thin to be an explanation`,
  ).toBeGreaterThan(8);
  return text;
}

describe("explanatory copy lives behind the info button", () => {
  it("Layout: the grid overlay tip explains itself", async () => {
    render(
      <LayoutSection
        theme={theme()}
        onChange={vi.fn()}
        onCanvasChange={vi.fn()}
        showGrid
        onShowGridChange={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Empty slots while you design/)).toBeNull();

    // Carousel is pulled for the MVP: grid is the only layout, so there is no
    // mode to pick and no control for it.
    expect(screen.queryByText("Display mode")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Display mode" })).toBeNull();

    expect(await openTip("Who sees the grid")).toMatch(/buyers never see it/i);
  });

  it("Sold out: the badge tip answers for the state the other switch is in", async () => {
    const { unmount } = render(
      <SoldOutSection theme={{ ...theme(), hideSoldOut: false }} onChange={vi.fn()} />,
    );
    expect(await openTip("When the sold-out badge appears")).toMatch(
      /marks a sold-out product/i,
    );
    unmount();

    render(<SoldOutSection theme={{ ...theme(), hideSoldOut: true }} onChange={vi.fn()} />);
    expect(await openTip("When the sold-out badge appears")).toMatch(/nothing to mark/i);
  });

  it("Looks: says what a preset changes AND what it leaves alone", async () => {
    render(<LooksSection theme={theme()} onChange={vi.fn()} />);
    expect(screen.queryByText(/Restyles the whole storefront/)).toBeNull();

    // The reassurance is the load-bearing half: nobody tries a look if they
    // think it might eat the layout they just built.
    const tip = await openTip("What picking a look changes");
    expect(tip).toMatch(/colours|font|corners/i);
    expect(tip).toMatch(/layout|left exactly as they are/i);
  });

  it("Analytics: a section explains what it measures instead of printing it", async () => {
    render(
      <AnalyticsSection
        id="sales"
        title="Sales"
        description="Money that actually landed in the business: paid orders across the range, with refunds already taken off."
        icon={Layers}
        state="live"
      >
        <div />
      </AnalyticsSection>,
    );
    expect(screen.queryByText(/Money that actually landed/)).toBeNull();
    expect(await openTip("What Sales measures")).toMatch(/paid orders/i);
  });
});
