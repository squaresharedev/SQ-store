import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { NavigationBlockerProvider, useNavigationBlocker } from "@/lib/hooks/useNavigationBlocker";

// "I've made the changes" must not send the version the seller has not saved:
// while the form holds unsaved edits, the button says to save instead.

const requestModerationReview = vi.fn(async () => ({ ok: true as const, requestedAt: "2026-10-01T10:00:00Z" }));
vi.mock("@/lib/moderation/review-request", () => ({
  requestModerationReview: () => requestModerationReview(),
}));

import { ReviewRequestButton } from "@/components/products/ReviewRequestButton";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Stands in for the product form: armed exactly while it is dirty. */
function DirtyForm() {
  const blocker = useNavigationBlocker();
  useEffect(() => blocker?.register(() => {}), [blocker]);
  return null;
}

function renderButton({ dirty }: { dirty: boolean }) {
  render(
    <NavigationBlockerProvider>
      {dirty && <DirtyForm />}
      <ReviewRequestButton kind="product" id="p1" requestedAt={null} />
    </NavigationBlockerProvider>,
  );
}

describe("ReviewRequestButton with unsaved edits", () => {
  it("asks for a save first and sends nothing", async () => {
    renderButton({ dirty: true });
    await userEvent.click(screen.getByRole("button", { name: /review it/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Save your changes first.");
    expect(requestModerationReview).not.toHaveBeenCalled();
  });

  it("sends the request when everything is saved", async () => {
    renderButton({ dirty: false });
    await userEvent.click(screen.getByRole("button", { name: /review it/ }));
    expect(await screen.findByText(/Sent for review/)).toBeInTheDocument();
    expect(requestModerationReview).toHaveBeenCalledOnce();
  });
});
