import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { RemovalNotice } from "@/components/products/RemovalNotice";
import type { ProductRemoval } from "@/types/product";
import { msg } from "@/i18n/types";

afterEach(cleanup);

const requestReview = vi.hoisted(() => vi.fn());

vi.mock("@/lib/moderation/review-request", () => ({
  requestModerationReview: requestReview,
}));

const ID = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";

function takedown(overrides: Partial<ProductRemoval> = {}): ProductRemoval {
  return {
    kind: "paused",
    ground: "counterfeit",
    note: "Remove the logo from the second photo.",
    at: "2026-09-23T10:00:00Z",
    reviewRequestedAt: null,
    ...overrides,
  };
}

/**
 * The seller's banner is the record of a takedown and, for a pause, the only
 * way back. What matters is that the two kinds ask for different things: a
 * pause offers the button, a removal never does.
 */
describe("RemovalNotice", () => {
  it("frames a pause as something to fix, with the reviewer's note", () => {
    render(<RemovalNotice removal={takedown()} kind="product" id={ID} title="Print" />);

    expect(
      screen.getByRole("heading", { name: /paused until you change it/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/What needs to change/)).toBeInTheDocument();
    expect(screen.getByText(/Remove the logo from the second photo\./)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /I've made the changes, review it/i }),
    ).toBeInTheDocument();
  });

  it("says a removal is final and offers an appeal, not a button", () => {
    render(
      <RemovalNotice
        removal={takedown({ kind: "removed" })}
        kind="product"
        id={ID}
        title="Print"
      />,
    );

    expect(
      screen.getByRole("heading", { name: /was removed by SquareShare/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This is final/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: /ask us to look again/i })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:support@squareshare\.eu/),
    );
  });

  it("shows a request already sent instead of the button", () => {
    render(
      <RemovalNotice
        removal={takedown({ reviewRequestedAt: "2026-09-23T12:00:00Z" })}
        kind="product"
        id={ID}
        title="Print"
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Sent for review on 23 September 2026/);
  });

  it("keeps the button from a role that cannot edit", () => {
    render(
      <RemovalNotice
        removal={takedown()}
        kind="storefront"
        id={ID}
        title="Shop"
        canRequestReview={false}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Someone who can edit this storefront/)).toBeInTheDocument();
  });

  it("sends the request and turns into a confirmation", async () => {
    requestReview.mockResolvedValueOnce({ ok: true, requestedAt: "2026-09-24T09:00:00Z" });
    render(<RemovalNotice removal={takedown()} kind="product" id={ID} title="Print" />);

    await userEvent.click(
      screen.getByRole("button", { name: /I've made the changes, review it/i }),
    );

    expect(requestReview).toHaveBeenCalledWith("product", ID);
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Sent for review on 24 September 2026/,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why when the server refuses", async () => {
    requestReview.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "invalid_input",
        message: msg("Errors.moderation.removedNotPaused", { target: "product" }),
        fix: msg("Errors.moderation.removedFix"),
      },
    });
    render(<RemovalNotice removal={takedown()} kind="product" id={ID} title="Print" />);

    await userEvent.click(
      screen.getByRole("button", { name: /I've made the changes, review it/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /removed, not paused\. A removal is final\./,
    );
  });
});
