import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyButton } from "@/components/ui/CopyButton";

afterEach(cleanup);

/**
 * Install a clipboard stub and hand back its writeText spy.
 *
 * MUST be called after `userEvent.setup()`: user-event installs a clipboard
 * stub of its own, so stubbing first would just be overwritten and every test
 * would silently exercise user-event's always-succeeds clipboard.
 */
function stubClipboard(impl: () => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

const resolves = () => Promise.resolve();
const rejects = () => Promise.reject(new Error("denied"));

describe("CopyButton", () => {
  it("writes the value to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard(resolves);
    render(<CopyButton value="order-123" label="order ID" />);

    await user.click(screen.getByRole("button"));

    expect(writeText).toHaveBeenCalledWith("order-123");
  });

  it("names the action before copying and the result after", async () => {
    const user = userEvent.setup();
    stubClipboard(resolves);
    render(<CopyButton value="order-123" label="order ID" />);

    await user.click(screen.getByRole("button", { name: "Copy order ID" }));

    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Copied order ID"),
    );
  });

  it("surfaces a denied clipboard instead of pretending it worked", async () => {
    const user = userEvent.setup();
    stubClipboard(rejects);
    render(<CopyButton value="order-123" label="order ID" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName(
        /couldn't copy order ID/i,
      ),
    );
  });

  it("reverts to the idle label after the copied state lapses", async () => {
    const user = userEvent.setup();
    stubClipboard(resolves);
    render(<CopyButton value="order-123" label="order ID" />);

    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Copied order ID"),
    );

    await waitFor(
      () => expect(screen.getByRole("button")).toHaveAccessibleName("Copy order ID"),
      { timeout: 3000 },
    );
  });

  it("renders the labelled variant with visible text", async () => {
    const user = userEvent.setup();
    stubClipboard(resolves);
    render(
      <CopyButton value="<script/>" label="embed snippet" variant="labelled" />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Copy");

    await user.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Copied"));
  });
});
