import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { USERNAME_MAX_LENGTH } from "@/lib/validation/auth";

afterEach(cleanup);

const mockUpdateUsername = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/settings/actions", () => ({
  updateUsername: mockUpdateUsername,
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

const { UsernameForm } = await import("@/components/settings/UsernameForm");

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ available: true }),
  });
});

describe("UsernameForm", () => {
  it("labels itself as the sign-in handle, not the public name", () => {
    render(<UsernameForm username="builderboy" />);
    expect(screen.getByRole("heading", { name: "Username" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("builderboy");
    expect(screen.getByText(/sign in with this instead of your email/i)).toBeInTheDocument();
  });

  it("normalizes while typing, so the field shows what will actually be stored", async () => {
    // Accepting "BuilderBoy" and quietly saving "builderboy" would leave the
    // user looking at a value their account does not have.
    const user = userEvent.setup();
    render(<UsernameForm username="" />);

    const field = screen.getByLabelText("Username");
    await user.type(field, "BuilderBoy");

    expect(field).toHaveValue("builderboy");
  });

  it("caps typed length at the number the server enforces", () => {
    render(<UsernameForm username="builderboy" />);
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "maxlength",
      String(USERNAME_MAX_LENGTH),
    );
  });

  it("reads your own handle back as yours without asking the server", async () => {
    render(<UsernameForm username="builderboy" />);
    expect(await screen.findByText("That's your username.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never checks a handle that cannot be valid", async () => {
    const user = userEvent.setup();
    render(<UsernameForm username="" />);

    await user.type(screen.getByLabelText("Username"), "ab");

    // Debounce is 400ms; give it room to have fired if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a handle someone else holds and blocks the save", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ available: false }),
    });
    const user = userEvent.setup();
    render(<UsernameForm username="" />);

    await user.type(screen.getByLabelText("Username"), "takenhandle");

    expect(
      await screen.findByText(/someone already has this username/i, undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
  });
});
