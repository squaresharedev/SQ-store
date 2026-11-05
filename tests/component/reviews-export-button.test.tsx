import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { ReviewsExportButton } from "@/components/products/ReviewsExportButton";
import { DEFAULT_REVIEW_FILTERS } from "@/lib/reviews/seller-filters";
import { REVIEWS_EXPORT_TRUNCATED_HEADER } from "@/lib/reviews/export";

/**
 * "Export CSV" on the reviews page (ui/DownloadButton underneath): it asks
 * for the view on screen, saves what comes back under the server's name,
 * says when the file was cut short, and shows a refusal in place.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom has no object URLs: record what the download was handed. */
function captureDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  let pending: Blob | null = null;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    pending = blob;
    return "blob:review-export";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: pending! });
  });
  return saved;
}

function csvResponse(headers: Record<string, string> = {}) {
  return new Response("﻿review_id\r\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="square-share-reviews-2026-10-28.csv"',
      ...headers,
    },
  });
}

describe("ReviewsExportButton", () => {
  it("asks for the view on screen and saves the file under the server's name", async () => {
    const saved = captureDownloads();
    const fetchMock = vi.fn(async () => csvResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ReviewsExportButton filters={{ ...DEFAULT_REVIEW_FILTERS, rating: 1, sort: "oldest" }} count={3} />);

    const button = screen.getByRole("button", { name: /Export CSV/ });
    expect(button.getAttribute("title")).toBe("Download the reviews in this view as a CSV file.");
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledWith("/api/sellers/export-reviews?rating=1&sort=oldest", { cache: "no-store" });
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("square-share-reviews-2026-10-28.csv");
    // Nothing was cut, so nothing to say.
    expect(screen.queryByText(/The file holds/)).toBeNull();
  });

  it("says when the file holds only the first part of the view", async () => {
    captureDownloads();
    vi.stubGlobal("fetch", vi.fn(async () => csvResponse({ [REVIEWS_EXPORT_TRUNCATED_HEADER]: "5000" })));
    const user = userEvent.setup();
    render(<ReviewsExportButton filters={DEFAULT_REVIEW_FILTERS} count={7200} />);
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(
      await screen.findByText(
        "The file holds the first 5,000 reviews of this view. Narrow the list by product or rating to export the rest.",
      ),
    ).toBeTruthy();
  });

  it("shows the server's refusal, and its fix, in place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "That's a lot of review exports in a short time.", fix: "Wait a few minutes and try again." },
          { status: 429 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ReviewsExportButton filters={DEFAULT_REVIEW_FILTERS} count={3} />);
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(await screen.findByText("That's a lot of review exports in a short time.")).toBeTruthy();
    expect(screen.getByText("Wait a few minutes and try again.")).toBeTruthy();
    // Ready again for another try.
    expect((screen.getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("is off while the view is empty, saying why", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewsExportButton filters={DEFAULT_REVIEW_FILTERS} count={0} />);
    const button = screen.getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("There are no reviews in this view to export.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
