/**
 * PasswordInput: a show/hide toggle by default, and none at all where the field
 * holds the account's EXISTING password (Settings' re-authentication fields),
 * which a browser may fill and a toggle would then display.
 */

import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { PasswordInput } from "@/components/ui/password-input";

afterEach(cleanup);

describe("PasswordInput", () => {
  it("offers a show/hide toggle by default", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="New password" />);
    const field = screen.getByLabelText("New password");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
  });

  it("with revealable={false}, has no toggle and stays masked whatever it is passed", () => {
    render(
      // A caller's `type` must not unmask it either.
      <PasswordInput aria-label="Current password" revealable={false} type="text" />,
    );
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: /show password/i })).toBeNull();
  });
});
