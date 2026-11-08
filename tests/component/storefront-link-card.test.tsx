import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import { StorefrontLinkCard } from "@/components/storefront/StorefrontLinkCard";

afterEach(cleanup);

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PAGE_URL = `https://squareshare.example/s/${ID}`;

describe("the storefront's own link", () => {
  it("says when search engines are kept away from it, and leads to the switch", () => {
    render(<StorefrontLinkCard storefrontId={ID} url={PAGE_URL} state="live" searchable={false} />);
    expect(screen.getByText(/hidden from search engines like google/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Allow search engines" })).toHaveAttribute(
      "href",
      `/storefront/${ID}?setting=product-page-indexing`,
    );
  });

  it("says nothing about search while engines may list it, or while there is no link", () => {
    render(<StorefrontLinkCard storefrontId={ID} url={PAGE_URL} state="live" searchable />);
    expect(screen.queryByText(/hidden from search engines/i)).toBeNull();
    cleanup();
    render(<StorefrontLinkCard storefrontId={ID} url={PAGE_URL} state="pages-off" searchable={false} />);
    expect(screen.queryByText(/hidden from search engines/i)).toBeNull();
  });

  it("gives each missing piece its way to fix it, never a diagnosis alone", () => {
    render(
      <StorefrontLinkCard storefrontId={ID} url={PAGE_URL} state="details-missing" searchable missing={["address"]} />,
    );
    // Straight to the first field still owed, as the seller-details notice does.
    expect(screen.getByRole("link", { name: "Add seller details" })).toHaveAttribute(
      "href",
      "/settings/business#address",
    );
    cleanup();
    render(<StorefrontLinkCard storefrontId={ID} url={PAGE_URL} state="pages-off" searchable />);
    expect(screen.getByRole("link", { name: "Open designer" })).toHaveAttribute("href", `/storefront/${ID}`);
    expect(screen.queryByRole("link", { name: "Add seller details" })).toBeNull();
  });
});
