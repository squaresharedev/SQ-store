import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "../setup/render";
import { FinishControls } from "@/components/storefront/FinishControls";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

afterEach(cleanup);

const THEME = DEFAULT_STOREFRONT_CONFIG.theme;

describe("FinishControls", () => {
  it("shows Motion, set to None on a storefront saved before it", () => {
    render(<FinishControls theme={THEME} onChange={vi.fn()} />);
    const motion = screen.getByRole("group", { name: "Motion" });
    expect(within(motion).getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
  });

  it("writes a preset, and drops the key again for None", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<FinishControls theme={THEME} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Lively" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...THEME, motion: "lively" });
    rerender(<FinishControls theme={{ ...THEME, motion: "lively" }} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "None" }));
    expect("motion" in onChange.mock.lastCall![0]).toBe(false);
  });

  it("keeps the paper texture behind More, folded until one is chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<FinishControls theme={THEME} onChange={onChange} />);
    const more = container.querySelector("details")!;
    expect(more).not.toHaveAttribute("open");
    await user.click(within(more).getByText("More"));
    await user.click(within(more).getByRole("button", { name: "Strong" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...THEME, texture: "strong" });
    cleanup();
    const { container: chosen } = render(<FinishControls theme={{ ...THEME, texture: "light" }} onChange={vi.fn()} />);
    expect(chosen.querySelector("details")).toHaveAttribute("open");
  });
});
