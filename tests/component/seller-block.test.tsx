import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SellerBlock, hasSellerDetails } from "@/components/product-page/SellerBlock";
import type { StorefrontSeller } from "@/types/storefront";

afterEach(cleanup);

/**
 * A raw value with no label reads as nothing in particular: "Czechia" on its
 * own line could be where the seller is based, where the item ships from, or
 * something else entirely. Every field here (besides the name, which IS the
 * answer to "who" right under the "Seller" heading) must say what it is
 * before it says what it holds.
 */
describe("SellerBlock", () => {
  const FULL: StorefrontSeller = {
    businessName: "Ikea",
    address: "1 Furniture Way\nPrague, 100 00",
    email: "hi@ikea.example",
    vatId: "CZ12345678",
    country: "CZ",
    phone: "+420 123 456 789",
  };

  it("labels every field except the name, which stands as the heading line", () => {
    render(<SellerBlock seller={FULL} fallbackName="Fallback Shop" />);
    expect(screen.getByText("Ikea")).toBeInTheDocument();
    expect(screen.getByText(/Address:/)).toBeInTheDocument();
    expect(screen.getByText(/Country:/)).toBeInTheDocument();
    expect(screen.getByText("Czechia")).toBeInTheDocument();
    expect(screen.getByText(/Email:/)).toBeInTheDocument();
    expect(screen.getByText(/Phone:/)).toBeInTheDocument();
    expect(screen.getByText(/VAT ID:/)).toBeInTheDocument();
    // The country CODE never leaks to the page — only the resolved name.
    expect(screen.queryByText("CZ")).toBeNull();
  });

  it("still renders the email as a working mailto link, label and all", () => {
    render(<SellerBlock seller={FULL} fallbackName="Fallback Shop" />);
    const link = screen.getByRole("link", { name: "hi@ikea.example" });
    expect(link).toHaveAttribute("href", "mailto:hi@ikea.example");
  });

  it("falls back to the storefront name when no business name was given", () => {
    render(<SellerBlock seller={{ country: "IE" }} fallbackName="Fallback Shop" />);
    expect(screen.getByText("Fallback Shop")).toBeInTheDocument();
  });

  it("prints only what is actually set, each on its own labelled row", () => {
    render(<SellerBlock seller={{ businessName: "Solo Studio" }} fallbackName="x" />);
    expect(screen.getByText("Solo Studio")).toBeInTheDocument();
    for (const label of [/Address:/, /Country:/, /Email:/, /Phone:/, /VAT ID:/]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("hasSellerDetails is true the moment any one field is set", () => {
    expect(hasSellerDetails({})).toBe(false);
    expect(hasSellerDetails({ phone: "+420 123 456 789" })).toBe(true);
    expect(hasSellerDetails({ vatId: "CZ1" })).toBe(true);
  });
});
