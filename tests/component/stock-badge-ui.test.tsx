import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StockBadge } from "@/components/ui/StockBadge";

afterEach(cleanup);

describe("StockBadge", () => {
  it("renders nothing when badge is null", () => {
    const { container } = render(<StockBadge badge={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("in_stock: renders nothing when showInStock is false (default)", () => {
    const { container } = render(<StockBadge badge={{ state: "in_stock" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("in_stock with showInStock=true: renders 'In stock'", () => {
    render(<StockBadge badge={{ state: "in_stock" }} showInStock />);
    expect(screen.getByText("In stock")).toBeInTheDocument();
  });

  it("low_stock: shows remaining count", () => {
    render(<StockBadge badge={{ state: "low_stock", remaining: 3 }} />);
    expect(screen.getByText("Only 3 left")).toBeInTheDocument();
  });

  it("low_stock remaining=1: singular count", () => {
    render(<StockBadge badge={{ state: "low_stock", remaining: 1 }} />);
    expect(screen.getByText("Only 1 left")).toBeInTheDocument();
  });

  it("sold_out: shows 'Sold out'", () => {
    render(<StockBadge badge={{ state: "sold_out" }} />);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });

  it("in_stock badge is not a link or interactive element", () => {
    render(<StockBadge badge={{ state: "in_stock" }} showInStock />);
    const badge = screen.getByText("In stock");
    expect(badge.tagName).toBe("SPAN");
  });

  it("sold_out badge is not a link or interactive element", () => {
    render(<StockBadge badge={{ state: "sold_out" }} />);
    const badge = screen.getByText("Sold out");
    expect(badge.tagName).toBe("SPAN");
  });
});
