import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { RemovalNotice } from "@/components/products/RemovalNotice";
import type { ProductRemoval } from "@/types/product";
import { msg } from "@/i18n/types";

afterEach(cleanup);

const requestReview = vi.hoisted(() => vi.fn());
const fileAppeal = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/moderation/review-request", () => ({
  requestModerationReview: requestReview,
}));
vi.mock("@/lib/moderation/appeals", () => ({
  fileModerationAppeal: fileAppeal,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const ID = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";
const DECISION = "d3c15e0f-1111-4222-8333-444455556666";

function takedown(overrides: Partial<ProductRemoval> = {}): ProductRemoval {
  return {
    kind: "paused",
    ground: "counterfeit",
    note: "Remove the logo from the second photo.",
    at: "2026-09-23T10:00:00Z",
    reviewRequestedAt: null,
    fields: [],
    decisionId: null,
    ...overrides,
  };
}

/**
 * The seller's banner is the record of a takedown and, for a pause, the only
 * way back. What matters is that the two kinds ask for different things: a
 * pause offers the button, a removal never does; and that a decision with a
 * record can be downloaded and appealed from right here.
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
    // A takedown older than the decision record has no in-app appeal to
    // offer, so it keeps the address to write to.
    expect(screen.getByRole("link", { name: /ask us to look again/i })).toHaveAttribute(
      "href",
      "mailto:support@squareshare.eu",
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
        removal={takedown({ decisionId: DECISION })}
        kind="storefront"
        id={ID}
        title="Shop"
        canRequestReview={false}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Someone who can edit this storefront/)).toBeInTheDocument();
    // They may still keep the record.
    expect(screen.getByRole("link", { name: "Download the decision (PDF)" })).toBeInTheDocument();
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
      /removed, not paused\. A removal is final unless an appeal changes it\./,
    );
  });
});

describe("RemovalNotice with a decision on record", () => {
  it("leads with what to change, each part one click from where it is", async () => {
    const section = document.createElement("section");
    section.id = "product-section-photos";
    section.scrollIntoView = vi.fn();
    document.body.append(section);

    render(
      <RemovalNotice
        removal={takedown({ fields: ["title", "photos"], decisionId: DECISION })}
        kind="product"
        id={ID}
        title="Print"
      />,
    );
    const notice = document.querySelector<HTMLElement>("[data-removal-notice]")!;

    expect([...notice.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
      "What to change",
      "Why",
      "Paused on",
      "Reference",
    ]);
    expect(within(notice).getByText("MD-D3C15E0F11")).toBeInTheDocument();

    await userEvent.click(within(notice).getByRole("button", { name: "Show Photos on this page" }));
    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("#product-section-photos");
    section.remove();
  });

  it("offers the statement as a download", () => {
    render(
      <RemovalNotice
        removal={takedown({ kind: "removed", decisionId: DECISION })}
        kind="product"
        id={ID}
        title="Print"
      />,
    );
    const link = screen.getByRole("link", { name: "Download the decision (PDF)" });
    expect(link).toHaveAttribute("href", `/api/moderation/decisions/${DECISION}/statement`);
    expect(link).toHaveAttribute("download");
    // The mailto is only for takedowns without a record.
    expect(screen.queryByRole("link", { name: /ask us to look again/i })).toBeNull();
  });

  it("files an appeal once it says enough, and then shows where it stands", async () => {
    fileAppeal.mockResolvedValueOnce({
      ok: true,
      appeal: { status: "open", filedAt: "2026-09-25T09:00:00Z", decidedAt: null, note: null },
    });
    render(
      <RemovalNotice
        removal={takedown({ kind: "removed", decisionId: DECISION })}
        kind="product"
        id={ID}
        title="Print"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Appeal this decision" }));
    const dialog = screen.getByRole("dialog");
    const box = within(dialog).getByLabelText("Why do you think this decision is wrong?");
    const send = within(dialog).getByRole("button", { name: "Send appeal" });

    await userEvent.type(box, "Too short");
    expect(send).toBeDisabled();
    await userEvent.type(box, ", but this is our own registered mark.");
    expect(send).toBeEnabled();
    await userEvent.click(send);

    expect(fileAppeal).toHaveBeenCalledWith(
      DECISION,
      "Too short, but this is our own registered mark.",
    );
    // The toast says it was sent; the banner says where it stands.
    expect(await screen.findByText("Appeal sent. We will get back to you.")).toBeInTheDocument();
    const status = document.querySelector("[data-appeal-status]");
    expect(status).toHaveAttribute("data-appeal-status", "open");
    expect(status).toHaveTextContent(/You appealed on 25 September 2026\. A person will review it/);
    expect(screen.queryByRole("button", { name: "Appeal this decision" })).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an answered appeal with our answer, and no second appeal", () => {
    render(
      <RemovalNotice
        removal={takedown({
          kind: "removed",
          decisionId: DECISION,
          appeal: {
            status: "upheld",
            filedAt: "2026-09-24T09:00:00Z",
            decidedAt: "2026-09-25T09:00:00Z",
            note: "The logo is still on the packaging.",
          },
        })}
        kind="product"
        id={ID}
        title="Print"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /We reviewed your appeal on 25 September 2026\. The decision stands\./,
    );
    expect(screen.getByText("Our answer: The logo is still on the packaging.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appeal this decision" })).toBeNull();
  });

  it("points a storefront's seller at its editor, and names the parts as plain labels", () => {
    render(
      <RemovalNotice
        removal={takedown({ fields: ["images", "text"], decisionId: DECISION })}
        kind="storefront"
        id={ID}
        title="Shop"
      />,
    );
    const notice = document.querySelector<HTMLElement>("[data-removal-notice]")!;
    // In the order the read put them in (takedownFromRow sorts them; this
    // fixture stands for its output).
    expect([...notice.querySelectorAll("[data-fix-field]")].map((chip) => chip.textContent)).toEqual([
      "Images",
      "Text",
    ]);
    expect(within(notice).queryByRole("button", { name: /Show .* on this page/ })).toBeNull();
    expect(
      within(notice).getByRole("link", { name: "Open the storefront to change it" }),
    ).toHaveAttribute("href", `/storefront/${ID}`);
  });
});
