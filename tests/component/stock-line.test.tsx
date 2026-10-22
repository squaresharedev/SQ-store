import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "../setup/render";
import { StockLine } from "@/components/product-page/StockLine";

/**
 * Availability on the product page: with the page's switch on, every product a
 * buyer can buy says so. A physical product that does not track stock is in
 * stock while it is not sold out (it used to say nothing, so the switch looked
 * broken), and reads the same as a tracked one.
 */

afterEach(cleanup);

const line = () => document.querySelector<HTMLElement>("[data-product-stock]");

describe("StockLine", () => {
  it("says in stock for a product that does not track stock, the same as one that does", () => {
    render(<StockLine stock={null} soldOut={false} isDigital={false} digitalFormat={null} />);
    expect(line()).toHaveTextContent(/^In stock$/);
    expect(line()).toHaveAttribute("data-product-stock", "in_stock");
    cleanup();
    render(<StockLine stock={{ state: "in_stock" }} soldOut={false} isDigital={false} digitalFormat={null} />);
    expect(line()).toHaveTextContent(/^In stock$/);
  });

  it("still says how few are left, and sold out over everything", () => {
    render(<StockLine stock={{ state: "low_stock", remaining: 2 }} soldOut={false} isDigital={false} digitalFormat={null} />);
    expect(line()).toHaveTextContent("Only 2 left");
    cleanup();
    render(<StockLine stock={null} soldOut isDigital={false} digitalFormat={null} />);
    expect(line()).toHaveTextContent(/^Sold out$/);
  });

  it("says a download is a download, not that it is in stock", () => {
    render(<StockLine stock={null} soldOut={false} isDigital digitalFormat="PDF" />);
    expect(line()).not.toHaveTextContent("In stock");
    expect(line()).toHaveTextContent("PDF");
  });
});
