import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { english } from "../setup/translate";
import { msg } from "@/i18n/types";
import { ReviewRequestButton } from "@/components/products/ReviewRequestButton";

afterEach(cleanup);

const requestReview = vi.hoisted(() => vi.fn());

vi.mock("@/lib/moderation/review-request", () => ({
  requestModerationReview: requestReview,
}));

const ID = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";
const LABEL = "I've made the changes, review it";

describe("ReviewRequestButton English copy", () => {
  it("labels the button", () => {
    render(<ReviewRequestButton kind="product" id={ID} requestedAt={null} />);
    expect(screen.getByRole("button")).toHaveTextContent(LABEL);
    expect(english("Products.removal.reviewRequest.button")).toBe(LABEL);
  });

  it("says Sending while the request is in flight", async () => {
    let settle: (value: unknown) => void = () => {};
    requestReview.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    render(<ReviewRequestButton kind="product" id={ID} requestedAt={null} />);

    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    settle({ ok: true, requestedAt: "2026-09-24T09:00:00Z" });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("prints a request already sent as one sentence, with a machine-readable date", () => {
    render(
      <ReviewRequestButton kind="storefront" id={ID} requestedAt="2026-09-23T12:00:00Z" />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe(
      "Sent for review on 23 September 2026. A person will look at your changes, and you will hear back here and by email.",
    );
    expect(status.querySelector("time")).toHaveAttribute("datetime", "2026-09-23T12:00:00Z");
    expect(status.querySelector("time")).toHaveTextContent(/^23 September 2026$/);
  });

  it("falls back to its own sentence when the request cannot be made", async () => {
    requestReview.mockRejectedValueOnce(new Error("network"));
    render(<ReviewRequestButton kind="product" id={ID} requestedAt={null} />);

    await userEvent.click(screen.getByRole("button"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That could not be sent. Try again in a moment.",
    );
  });

  it("resolves the server's ActionError refs", async () => {
    requestReview.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "invalid_input",
        message: msg("Errors.moderation.notPaused", { target: "storefront" }),
        fix: msg("Errors.moderation.notPausedFix"),
      },
    });
    render(<ReviewRequestButton kind="storefront" id={ID} requestedAt={null} />);

    await userEvent.click(screen.getByRole("button"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This storefront is not paused. There is nothing to review: it is already visible to buyers.",
    );
  });
});
