import { describe, expect, it } from "vitest";
import { mayOweEuRights, orderOwesEuRights } from "@/lib/storefront/product-page";
import type { StorefrontSeller } from "@/types/storefront";

// EU consumer rights follow the buyer, wherever the seller is based. So a page
// must not stay silent about them just because a seller is American, or never
// said where they are.

const seller = (country?: string) => ({ country }) as StorefrontSeller;
const goods = (codes: string[], anywhere = false) => ({ isDigital: false, reach: { codes, anywhere } });

describe("mayOweEuRights", () => {
  it("is true for a seller based in the EU, whoever they deliver to", () => {
    expect(mayOweEuRights(seller("CZ"), goods(["US"]))).toBe(true);
  });

  it("is true for a seller outside the EU who delivers into it", () => {
    expect(mayOweEuRights(seller("US"), goods(["US", "DE"]))).toBe(true);
    expect(mayOweEuRights(seller("CA"), goods([], true))).toBe(true);
  });

  it("is true for a download, which an EU buyer can buy from anywhere", () => {
    expect(mayOweEuRights(seller("US"), { isDigital: true, reach: { codes: [], anywhere: false } })).toBe(true);
  });

  it("is true when the seller never said where they are", () => {
    expect(mayOweEuRights(seller(undefined), goods(["US"]))).toBe(true);
    expect(mayOweEuRights(undefined, goods(["US"]))).toBe(true);
  });

  it("is false only where no EU buyer can be reached", () => {
    expect(mayOweEuRights(seller("US"), goods(["US", "CA"]))).toBe(false);
  });
});

describe("orderOwesEuRights", () => {
  it("follows the delivery country once it is known", () => {
    expect(orderOwesEuRights(seller("US"), { isDigital: false, shipToCountry: "DE" })).toBe(true);
    expect(orderOwesEuRights(seller("US"), { isDigital: false, shipToCountry: "US" })).toBe(false);
    expect(orderOwesEuRights(seller(undefined), { isDigital: false, shipToCountry: "US" })).toBe(false);
  });

  it("keeps an EU seller's promise to everyone", () => {
    expect(orderOwesEuRights(seller("IE"), { isDigital: false, shipToCountry: "US" })).toBe(true);
  });

  it("says so when it cannot tell where the buyer is", () => {
    expect(orderOwesEuRights(seller("US"), { isDigital: true, shipToCountry: null })).toBe(true);
  });
});
