import { notFound } from "next/navigation";
import { ShippingSection } from "@/components/settings/ShippingSection";
import { EMPTY_SHIPPING_POLICY, type SellerShippingPolicy } from "@/types/shipping-policy";

// Living reference for Settings › Shipping (components/settings/ShippingSection):
// `?state=filled` opens a store with terms written, anything else a blank one.
// Dev-only: the route 404s in production builds, and nothing here saves.

export const metadata = { title: "Shipping settings: dev harness" };

const FILLED: SellerShippingPolicy = {
  shipsFrom: "PT",
  dispatch: "1-2",
  destinations: [
    { area: "Portugal", time: "1–2 working days", countries: ["PT"], rateCents: 400 },
    { area: "Rest of the EU", time: "3–5 working days", countries: ["ES", "FR", "DE"], rateCents: 900 },
  ],
  ratesCurrency: "EUR",
  freeOverCents: 6000,
  returnsWindowDays: 30,
  returnsPaidBy: "buyer",
  profiles: [],
};

export default async function ShippingSettingsDevPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { state } = await searchParams;
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <ShippingSection
        policy={state === "filled" ? FILLED : EMPTY_SHIPPING_POLICY}
        continueHref="/storefront"
      />
    </main>
  );
}
