import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "../setup/render";
import { ReportDialog } from "@/components/product-page/ReportDialog";
import { RemovalBadge, RemovalNotice } from "@/components/products/RemovalNotice";

/**
 * The words around content reports and takedowns, as a reader sees them.
 *
 * Both surfaces now read their copy from the catalogue (ProductPage.report for
 * the buyer's dialog, Products.removal for the seller's banner). The e2e suite
 * asserts on these phrases, and the takedown banner is a statement of reasons
 * a seller is legally owed, so the English is pinned here word for word.
 */

const TARGET = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openDialog() {
  render(<ReportDialog targetType="product" targetId={TARGET} />);
  fireEvent.click(screen.getByRole("button", { name: "Report this product" }));
  return screen.getByRole("dialog");
}

describe("ReportDialog", () => {
  it("asks its question in the words it always used", () => {
    const dialog = openDialog();

    expect(within(dialog).getByRole("heading", { name: "Report this product" })).toBeVisible();
    expect(
      within(dialog).getByText("Tell us what is wrong with it. A person reviews every report."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("What is wrong with it?").tagName).toBe("LEGEND");

    const illegal = within(dialog).getByRole("radio", { name: /Illegal goods or activity/ });
    expect(illegal.closest("label")?.textContent).toBe(
      "Illegal goods or activitySelling something that is against the law, or using the listing to arrange it.",
    );
    expect(within(dialog).getAllByRole("radio")).toHaveLength(8);

    const details = within(dialog).getByLabelText("Anything else? (optional)");
    expect(details).toHaveAttribute("placeholder", "What should the person reviewing this know?");
    const email = within(dialog).getByLabelText("Your email (optional)");
    expect(email).toHaveAttribute("placeholder", "you@example.com");
    expect(
      within(dialog).getByText(
        "Only so we can confirm we got this and ask a question if we need to. It is never shown to the seller.",
      ),
    ).toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Send report" })).toBeDisabled();
  });

  it("confirms without saying what happened underneath", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, message: "ignored" }, { status: 202 })),
    );
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Spam/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    expect(await screen.findByRole("heading", { name: "Report sent" })).toBeVisible();
    expect(
      screen.getByText(
        "Thanks. A person will review this product. We do not share who reported something with the seller.",
      ),
    ).toBeInTheDocument();
    // The modal's own X is also named "Close"; this is the visible button.
    expect(
      screen.getAllByRole("button", { name: "Close" }).map((button) => button.textContent),
    ).toContain("Close");
  });

  it("shows the endpoint's own refusal, and its own words when there is none", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "Too many reports from here. Try again later." }, { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Spam/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Too many reports from here. Try again later.",
    );

    fetchMock.mockImplementationOnce(async () => new Response("", { status: 503 }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        "That could not be submitted. Try again.",
      ),
    );

    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("offline");
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        "That could not be submitted. Check your connection and try again.",
      ),
    );
  });

  it("names a storefront when that is what is being reported", () => {
    render(<ReportDialog targetType="storefront" targetId={TARGET} />);
    fireEvent.click(screen.getByRole("button", { name: "Report this storefront" }));
    expect(screen.getByRole("heading", { name: "Report this storefront" })).toBeVisible();
  });
});

describe("RemovalNotice", () => {
  it("states what happened, why, when, and how to argue, word for word", () => {
    render(
      <RemovalNotice
        removal={{
          kind: "removed",
          ground: "counterfeit",
          note: "The mark is registered.",
          at: "2026-09-17T10:00:00Z",
          reviewRequestedAt: null,
        }}
        kind="product"
        id={TARGET}
        title="Brass lamp"
      />,
    );
    const notice = document.querySelector<HTMLElement>("[data-removal-notice]")!;

    expect(within(notice).getByRole("heading").textContent).toBe(
      "This product was removed by SquareShare",
    );
    expect(
      within(notice).getByText(
        "It is no longer visible to buyers anywhere: not on its page, not in an embed, not in a shared link. This is final, so editing it will not bring it back.",
      ),
    ).toBeInTheDocument();
    expect([...notice.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
      "Reason",
      "When",
    ]);
    expect([...notice.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual([
      "Counterfeit or stolen. It appeared to offer counterfeit goods, or work that belongs to someone else. The mark is registered.",
      "17 September 2026",
    ]);

    const link = within(notice).getByRole("link", { name: "ask us to look again" });
    expect(link.parentElement?.textContent).toBe(
      "If you think we got this wrong, ask us to look again.",
    );
    const href = new URL(link.getAttribute("href")!);
    expect(href.searchParams.get("subject")).toBe("Appeal: product removal (Brass lamp)");
  });

  it("falls back to the catch-all ground, and leaves out a missing date", () => {
    render(
      <RemovalNotice
        removal={{ kind: "removed", ground: "nonsense", note: null, at: null, reviewRequestedAt: null }}
        kind="storefront"
        id={TARGET}
        title="Shop"
      />,
    );
    const notice = document.querySelector<HTMLElement>("[data-removal-notice]")!;
    expect(within(notice).getByRole("heading").textContent).toBe(
      "This storefront was removed by SquareShare",
    );
    expect([...notice.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual([
      "It broke the platform rules.",
    ]);
    expect(notice.textContent).toContain("If you think we got this wrong, ask us to look again.");
  });

  it("badges a card with one word", () => {
    render(<RemovalBadge kind="removed" />);
    expect(document.querySelector("[data-removal-badge]")?.textContent).toBe("Removed");
  });
});
