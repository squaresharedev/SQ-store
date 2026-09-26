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
const STOREFRONT = "5f0e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";

const PAGE = {
  product: { id: TARGET, title: "Brass lamp" },
  storefront: { id: STOREFRONT, name: "Lamp studio" },
  sellerName: "Lamp Studio s.r.o.",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openDialog() {
  render(<ReportDialog {...PAGE} />);
  fireEvent.click(screen.getByRole("button", { name: "Report this product" }));
  return screen.getByRole("dialog");
}

/** The body the dialog posted to /api/report. */
function posted(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
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

  it("offers only the product when the seller sells one thing from one storefront", () => {
    const dialog = openDialog();
    expect(dialog.querySelector("[data-report-scopes]")).toBeNull();
    // The eight reasons, and nothing else to choose.
    expect(within(dialog).getAllByRole("radio")).toHaveLength(8);
  });

  it("lets a buyer report the storefront or the seller when those differ from the product", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, message: "ok" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportDialog {...PAGE} scopes={{ storefront: true, seller: true }} />);
    // With a choice to make, the link no longer claims to be about the product.
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = screen.getByRole("dialog");

    const scopes = dialog.querySelector<HTMLElement>("[data-report-scopes]")!;
    expect(within(scopes).getByText("What do you want to report?").tagName).toBe("LEGEND");
    expect(
      within(scopes).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent),
    ).toEqual([
      "This productBrass lamp",
      "This storefrontLamp studio, and everything on it",
      "This sellerLamp Studio s.r.o., across all of their storefronts",
    ]);
    expect(within(scopes).getByRole("radio", { name: /This product/ })).toBeChecked();

    fireEvent.click(within(scopes).getByRole("radio", { name: /This storefront/ }));
    expect(within(dialog).getByRole("heading", { name: "Report this storefront" })).toBeVisible();

    fireEvent.click(within(scopes).getByRole("radio", { name: /This seller/ }));
    expect(within(dialog).getByRole("heading", { name: "Report this seller" })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Scam or fraud/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    // The seller is named by the storefront, never by an account id.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(posted(fetchMock)).toMatchObject({
      targetType: "seller",
      targetId: STOREFRONT,
      reason: "scam",
    });
    expect(
      await screen.findByText(
        "Thanks. A person will review this seller. We do not share who reported something with them.",
      ),
    ).toBeInTheDocument();
  });

  it("reports the storefront by its own id", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, message: "ok" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportDialog {...PAGE} scopes={{ storefront: true, seller: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog.querySelector<HTMLElement>("[data-report-scopes]")!).getAllByRole("radio"),
    ).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole("radio", { name: /This storefront/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Spam/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(posted(fetchMock)).toMatchObject({ targetType: "storefront", targetId: STOREFRONT });
  });

  it("starts over on the product after closing", () => {
    render(<ReportDialog {...PAGE} scopes={{ storefront: false, seller: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /This seller/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    return waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
      expect(
        within(screen.getByRole("dialog")).getByRole("radio", { name: /This product/ }),
      ).toBeChecked();
    });
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
          fields: [],
          decisionId: null,
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
    // A takedown from before the decision record: no in-app appeal exists
    // for it, so the address to write to.
    expect(link.getAttribute("href")).toBe("mailto:support@squareshare.eu");
  });

  it("falls back to the catch-all ground, and leaves out a missing date", () => {
    render(
      <RemovalNotice
        removal={{
          kind: "removed",
          ground: "nonsense",
          note: null,
          at: null,
          reviewRequestedAt: null,
          fields: [],
          decisionId: null,
        }}
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
