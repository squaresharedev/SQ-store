import { describe, it, expect, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, renderWithoutToasts, screen, cleanup } from "../setup/render";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import { msg } from "@/i18n/types";
import type { AttentionItem, AttentionKey } from "@/lib/dashboard/attention";

// The module only speaks when it has something to say. While the setup
// checklist is on screen, its open steps are the to-do list, and an "All
// clear" beside them would contradict it.
//
// Each row is one link (its label, an icon, a chevron); the sentence saying why
// is the link's description, not drawn. Past four rows the rest wait behind
// "Show N more", unless only one would.

afterEach(cleanup);

const TWO_FACTOR: AttentionItem = {
  key: "two-factor",
  label: msg("Dashboard.attention.twoFactor.label"),
  description: msg("Dashboard.attention.twoFactor.description"),
  href: "/settings/security#two-factor",
  actionLabel: msg("Dashboard.attention.twoFactor.action"),
};

const TO_SHIP: AttentionItem = {
  key: "to-ship",
  label: msg("Orders.toShipCount", { count: 25 }),
  description: msg("Dashboard.attention.toShip.description"),
  href: "/orders?view=to-ship",
  actionLabel: msg("Dashboard.attention.toShip.action"),
  urgent: true,
};

/** `count` distinct calm rows (the same copy, a different key and href each). */
function rows(count: number): AttentionItem[] {
  const keys: AttentionKey[] = ["two-factor", "stripe", "no-legal", "no-buy-path", "no-shipping", "checkout-rates", "storefront"];
  return keys.slice(0, count).map((key) => ({ ...TWO_FACTOR, key, href: `/x/${key}` }));
}

describe("NeedsAttention", () => {
  it("says all clear when nothing needs doing", () => {
    render(<NeedsAttention items={[]} />);
    expect(screen.getByText("All clear. Nothing needs your attention right now.")).toBeInTheDocument();
  });

  it("stands down rather than say all clear beside the setup checklist", () => {
    const { container } = renderWithoutToasts(<NeedsAttention items={[]} setupVisible />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still lists real rows while the setup checklist is on screen", () => {
    render(<NeedsAttention items={[TWO_FACTOR]} setupVisible />);
    expect(screen.getByRole("link", { name: "Turn on two-factor authentication" })).toHaveAttribute(
      "href",
      "/settings/security#two-factor",
    );
  });

  it("makes the whole row the link, with the why as its description rather than on screen", () => {
    render(<NeedsAttention items={[TWO_FACTOR]} />);
    const link = screen.getByRole("link", { name: "Turn on two-factor authentication" });
    expect(link).toHaveAccessibleDescription(
      "A code from your phone at sign-in, so a stolen password alone can't get into your store.",
    );
    expect(screen.queryByText(/A code from your phone/)).not.toBeVisible();
  });

  it("flags the rows where a buyer is waiting, and only those", () => {
    const { container } = render(<NeedsAttention items={[TO_SHIP, TWO_FACTOR]} />);
    expect(container.querySelector('[data-attention-row="to-ship"]')).toHaveAttribute("data-urgent", "true");
    expect(container.querySelector('[data-attention-row="two-factor"]')).not.toHaveAttribute("data-urgent");
  });

  it("shows four rows and keeps the rest behind Show more, and back", async () => {
    const user = userEvent.setup();
    render(<NeedsAttention items={rows(6)} />);
    expect(screen.getAllByRole("link")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getAllByRole("link")).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("shows a fifth row outright rather than hide one row behind a button", () => {
    render(<NeedsAttention items={rows(5)} />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Show/ })).not.toBeInTheDocument();
  });
});
