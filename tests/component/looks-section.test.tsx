import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { LooksSection } from "@/components/storefront/LooksSection";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

afterEach(cleanup);

const theme = () => ({ ...DEFAULT_STOREFRONT_CONFIG.theme });

/**
 * A look is a restyle, not a reshape: VIBE_PRESETS never mentions columns,
 * rows, or the sold-out settings, so those are the seller's own and picking a
 * look must leave them exactly where they were.
 *
 * This guards a real regression: the handler used to spread themeForVibe(),
 * which answers "what does a BRAND NEW storefront start on" by merging the
 * preset over DEFAULT_STOREFRONT_CONFIG.theme — silently smuggling that
 * default's columns/rows/soldOutBadge/hideSoldOut into the result and
 * snapping an already-resized canvas back to 6x6 on every click.
 */
describe("LooksSection", () => {
  it("leaves canvas size untouched when a look is applied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const resized = { ...theme(), columns: 10, rows: 14 };
    render(<LooksSection theme={resized} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /^Bold/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.columns).toBe(10);
    expect(next.rows).toBe(14);
  });

  it("leaves sold-out settings untouched when a look is applied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const customized = { ...theme(), soldOutBadge: false, hideSoldOut: true };
    render(<LooksSection theme={customized} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /^Classic/ }));

    const next = onChange.mock.calls[0][0];
    expect(next.soldOutBadge).toBe(false);
    expect(next.hideSoldOut).toBe(true);
  });

  it("still writes every field the look actually owns", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LooksSection theme={theme()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /^Bold/ }));

    const next = onChange.mock.calls[0][0];
    expect(next.titleDisplay).toBe("hover");
    expect(next.priceDisplay).toBe("always");
    expect(next.priceTagPosition).toBe("top-right");
  });
});
