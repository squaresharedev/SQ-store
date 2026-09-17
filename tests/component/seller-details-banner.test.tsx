/**
 * The chrome's seller-details banner, and the wrapper that stands it down on
 * Overview.
 *
 * An owner gets the gap and a link to the first field that closes it. A team
 * member on someone else's store gets the fact WITHOUT a link, because their
 * Settings edits their own profile and the banner would never clear. And on
 * Overview the banner is hidden, where the setup checklist says the same thing
 * as a step; HiddenOnPaths is that decision, by exact path.
 */

import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "../setup/render";

afterEach(cleanup);

const mockPath = vi.hoisted(() => ({ value: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath.value,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SellerDetailsBanner } from "@/components/settings/SellerDetailsNotice";
import { HiddenOnPaths } from "@/components/layout/HiddenOnPaths";

describe("SellerDetailsBanner", () => {
  it("tells an owner what is missing and links to the first field that fixes it", () => {
    render(<SellerDetailsBanner missing={["address", "email"]} />);
    const note = screen.getByRole("note", { name: "Seller details required" });
    expect(note).toHaveTextContent(
      "You can't publish or sell until your seller details are complete.",
    );
    expect(note).toHaveTextContent("business address and contact email");
    expect(screen.getByRole("link", { name: "Add seller details" })).toHaveAttribute(
      "href",
      "/settings/tax#address",
    );
  });

  it("gives a team member the fact, without a link into their own settings", () => {
    render(<SellerDetailsBanner missing={["businessName"]} audience="member" />);
    const note = screen.getByRole("note", { name: "Seller details required" });
    expect(note).toHaveTextContent("This store can't publish or sell yet.");
    expect(note).toHaveTextContent("Its owner has to add their seller details");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when nothing is missing", () => {
    render(<SellerDetailsBanner missing={[]} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("HiddenOnPaths", () => {
  it("hides its children on a listed path and shows them anywhere else", () => {
    mockPath.value = "/dashboard";
    const { rerender } = render(
      <HiddenOnPaths paths={["/dashboard"]}>
        <p>chrome</p>
      </HiddenOnPaths>,
    );
    expect(screen.queryByText("chrome")).toBeNull();

    mockPath.value = "/products";
    rerender(
      <HiddenOnPaths paths={["/dashboard"]}>
        <p>chrome</p>
      </HiddenOnPaths>,
    );
    expect(screen.getByText("chrome")).toBeInTheDocument();
  });

  it("matches the path exactly, never as a prefix", () => {
    mockPath.value = "/dashboard/anything";
    render(
      <HiddenOnPaths paths={["/dashboard"]}>
        <p>chrome</p>
      </HiddenOnPaths>,
    );
    expect(screen.getByText("chrome")).toBeInTheDocument();
  });
});
