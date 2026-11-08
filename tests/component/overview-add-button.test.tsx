import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderWithoutToasts, screen, cleanup } from "../setup/render";

// The phone top bar's Add product: Overview's own quick action, so it rides
// the shared bar on that page and nowhere else.

const mockPath = vi.hoisted(() => ({ value: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath.value,
}));

import { OverviewAddButton } from "@/components/dashboard/OverviewAddButton";

afterEach(cleanup);

describe("OverviewAddButton", () => {
  it("links to the new product form on Overview", () => {
    mockPath.value = "/dashboard";
    render(<OverviewAddButton />);
    expect(screen.getByRole("link", { name: "Add product" })).toHaveAttribute("href", "/products/new");
  });

  it("renders nothing on any other page", () => {
    mockPath.value = "/products";
    const { container } = renderWithoutToasts(<OverviewAddButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
