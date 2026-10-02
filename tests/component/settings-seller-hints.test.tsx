import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import type { SellerShippingPolicy } from "@/types/shipping-policy";

// Two settings pages that used to let a seller believe something that was not
// so: that email was going out, and that a finished-looking delivery row would
// let buyers check out.

vi.mock("@/lib/settings/actions", () => ({ saveNotifications: vi.fn(async () => ({})) }));
vi.mock("@/lib/settings/shipping-actions", () => ({ saveShippingPolicy: vi.fn(async () => ({})) }));

import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { ShippingSection } from "@/components/settings/ShippingSection";

afterEach(cleanup);

const DEFAULTS = { notify_sales: true, notify_product_updates: true, notify_marketing: false };

describe("the notification preferences", () => {
  it("say nothing extra where mail is switched on", () => {
    render(<NotificationsSection defaults={DEFAULTS} emailEnabled />);
    expect(document.querySelector("[data-email-off]")).toBeNull();
  });

  it("say so where mail is off, instead of letting the switches read as live", () => {
    render(<NotificationsSection defaults={DEFAULTS} emailEnabled={false} />);
    const note = document.querySelector("[data-email-off]");
    expect(note).toHaveTextContent("Email isn't switched on for Square Share yet");
    // What still works is said too, so the seller knows where orders will show.
    expect(note).toHaveTextContent("Orders");
  });

  it("describe the sales email as the one that says what to pack and where it goes", () => {
    render(<NotificationsSection defaults={DEFAULTS} emailEnabled />);
    expect(screen.getByText(/with what to pack and where to send it/)).toBeInTheDocument();
  });
});

describe("the delivery destinations", () => {
  const row = { area: "Ireland", time: "2 to 3 days" };
  const policyWith = (destination: SellerShippingPolicy["destinations"]): SellerShippingPolicy => ({
    destinations: destination,
    ratesCurrency: "EUR",
  });

  it("say when a named row has no rate and no country, so checkout cannot use it", () => {
    render(<ShippingSection policy={policyWith([row])} />);
    expect(document.querySelectorAll("[data-destination-needs-rate]")).toHaveLength(1);
    expect(screen.getByText(/Checkout can't use this row until it has both a rate and a country/)).toBeInTheDocument();
  });

  it("say it for a row with a rate but no country, and with a country but no rate", () => {
    render(
      <ShippingSection
        policy={policyWith([
          { ...row, rateCents: 450 },
          { area: "Germany", time: "3 days", countries: ["DE"] },
        ])}
      />,
    );
    expect(document.querySelectorAll("[data-destination-needs-rate]")).toHaveLength(2);
  });

  it("say nothing for a row that can be quoted", () => {
    render(<ShippingSection policy={policyWith([{ ...row, rateCents: 450, countries: ["IE"] }])} />);
    expect(document.querySelector("[data-destination-needs-rate]")).toBeNull();
  });

  it("do not scold a row that has not been named yet", () => {
    render(<ShippingSection policy={policyWith([{ area: "", time: "" }])} />);
    expect(document.querySelector("[data-destination-needs-rate]")).toBeNull();
  });
});
