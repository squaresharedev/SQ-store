import { describe, it, expect, afterEach } from "vitest";
import { render, renderWithoutToasts, screen, cleanup } from "../setup/render";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import { msg } from "@/i18n/types";
import type { AttentionItem } from "@/lib/dashboard/attention";

// The module only speaks when it has something to say. While the setup
// checklist is on screen, its open steps are the to-do list, and an "All
// clear" beside them would contradict it.

afterEach(cleanup);

const TWO_FACTOR: AttentionItem = {
  key: "two-factor",
  label: msg("Dashboard.attention.twoFactor.label"),
  description: msg("Dashboard.attention.twoFactor.description"),
  href: "/settings/security#two-factor",
  actionLabel: msg("Dashboard.attention.twoFactor.action"),
};

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
    expect(screen.getByText("Turn on two-factor authentication")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Turn on" })).toHaveAttribute(
      "href",
      "/settings/security#two-factor",
    );
  });
});
