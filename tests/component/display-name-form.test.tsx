import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/settings/constants";

afterEach(cleanup);

vi.mock("@/lib/settings/actions", () => ({
  updateDisplayName: vi.fn().mockResolvedValue({}),
}));

// jsdom ships neither of these; the form measures its input with one and
// debounce-checks availability with the other.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});

/** jsdom lays nothing out, so overflow has to be simulated. */
function setInputWidths({ scroll, client }: { scroll: number; client: number }) {
  Object.defineProperty(HTMLInputElement.prototype, "scrollWidth", {
    configurable: true,
    get: () => scroll,
  });
  Object.defineProperty(HTMLInputElement.prototype, "clientWidth", {
    configurable: true,
    get: () => client,
  });
}

const { DisplayNameForm } = await import(
  "@/components/settings/DisplayNameForm"
);

/** The gradient scrim over the clipped end of an overflowing name. */
const scrim = (container: HTMLElement) =>
  container.querySelector(".from-transparent");

describe("DisplayNameForm", () => {
  it("labels the field as the username, not the display name", () => {
    setInputWidths({ scroll: 100, client: 400 });
    render(<DisplayNameForm displayName="builderboy" />);
    expect(
      screen.getByRole("heading", { name: "Username" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });

  it("puts Save in the same row as the input rather than below the form", () => {
    setInputWidths({ scroll: 100, client: 400 });
    render(<DisplayNameForm displayName="builderboy" />);
    const row = screen.getByLabelText("Username").closest("div")?.parentElement;
    expect(row).not.toBeNull();
    expect(row).toContainElement(screen.getByRole("button", { name: "Save" }));
  });

  it("caps typed length at the same number the server enforces", () => {
    setInputWidths({ scroll: 100, client: 400 });
    render(<DisplayNameForm displayName="builderboy" />);
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "maxlength",
      String(DISPLAY_NAME_MAX_LENGTH),
    );
  });

  it("does not fade a name that fits", () => {
    setInputWidths({ scroll: 100, client: 400 });
    const { container } = render(<DisplayNameForm displayName="short" />);
    expect(scrim(container)).toBeNull();
  });

  it("fades the clipped end of a name too long for the field", () => {
    setInputWidths({ scroll: 900, client: 400 });
    const { container } = render(
      <DisplayNameForm displayName={"a".repeat(DISPLAY_NAME_MAX_LENGTH)} />,
    );
    expect(scrim(container)).not.toBeNull();
  });

  it("lifts the fade while the field is focused, so the caret is never under it", async () => {
    setInputWidths({ scroll: 900, client: 400 });
    const user = userEvent.setup();
    const { container } = render(
      <DisplayNameForm displayName={"a".repeat(DISPLAY_NAME_MAX_LENGTH)} />,
    );
    expect(scrim(container)).not.toBeNull();

    await user.click(screen.getByLabelText("Username"));
    expect(scrim(container)).toBeNull();

    await user.tab();
    expect(scrim(container)).not.toBeNull();
  });
});
