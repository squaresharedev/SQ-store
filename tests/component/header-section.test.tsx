import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { HeaderSection } from "@/components/storefront/HeaderSection";

afterEach(cleanup);

const header = { show: true, name: "Oak & Iron", bio: "Lamps, made slowly." };

/**
 * A LINE'S LOOK, REACHABLE FROM ITS FIELD. Font, size, colour, formatting and
 * alignment are set in the colour panel aimed at a masthead line, which a
 * click on that line opens. A seller who never thought to click the canvas
 * looked for them here, found two text fields, and decided the header could
 * not be styled.
 */
describe("HeaderSection", () => {
  it("opens each line's font and colour from under its own field", async () => {
    const onStyleLine = vi.fn();
    const user = userEvent.setup();
    render(<HeaderSection header={header} onChange={vi.fn()} onStyleLine={onStyleLine} />);

    await user.click(screen.getByRole("button", { name: "Font and colour of the name" }));
    expect(onStyleLine).toHaveBeenLastCalledWith("name");

    await user.click(screen.getByRole("button", { name: "Font and colour of the bio" }));
    expect(onStyleLine).toHaveBeenLastCalledWith("bio");
  });

  it("offers no link with nowhere to open it", () => {
    render(<HeaderSection header={header} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /font and colour/i })).toBeNull();
  });
});
