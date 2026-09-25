import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { CopyButton, type CopyButtonMessages } from "@/components/ui/CopyButton";

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

const orderId: CopyButtonMessages = {
  copy: "Orders.detail.copyOrderId.copy",
  copied: "Orders.detail.copyOrderId.copied",
  failed: "Orders.detail.copyOrderId.failed",
};

const snippet = {
  copy: "Storefront.embed.copySnippet.copy",
  copied: "Storefront.embed.copySnippet.copied",
  failed: "Storefront.embed.copySnippet.failed",
  cannotCopyYet: "Storefront.embed.copySnippet.cannotCopyYet",
} as const;

const resolves = () => Promise.resolve();
const rejects = () => Promise.reject(new Error("denied"));

describe("CopyButton", () => {
  it("writes the value to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard(resolves);
    render(<CopyButton value="order-123" messages={orderId} />);

    await user.click(screen.getByRole("button"));

    expect(writeText).toHaveBeenCalledWith("order-123");
  });

  it("names the action before copying and the result after", async () => {
    const user = userEvent.setup();
    stubClipboard(resolves);
    render(<CopyButton value="order-123" messages={orderId} />);

    await user.click(screen.getByRole("button", { name: "Copy order ID" }));

    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Copied order ID"),
    );
  });

  it("surfaces a denied clipboard instead of pretending it worked", async () => {
    const user = userEvent.setup();
    stubClipboard(rejects);
    render(<CopyButton value="order-123" messages={orderId} />);

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
    render(<CopyButton value="order-123" messages={orderId} />);

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
      <CopyButton value="<script/>" messages={snippet} variant="labelled" />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Copy");

    await user.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Copied"));
  });

  it("names a disabled button with the caller's own sentence", () => {
    render(<CopyButton value="<script/>" messages={snippet} disabled />);
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "embed snippet cannot be copied yet",
    );
  });
});
