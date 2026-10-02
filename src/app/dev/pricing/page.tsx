import { notFound } from "next/navigation";
import { PlanStatusBanner } from "@/components/billing/PlanStatusBanner";
import { PricingGallery } from "./PricingGallery";

// Living reference for plans & billing (components/billing): the plans page,
// the settings page and its upsell card in every state a store can be in,
// with stand-in actions (nothing is bought, nothing leaves the page), plus the
// rail's plan chip, the Orders export button (locked and not), and the
// past-due banner as an owner and as a teammate. No account, no database, no
// Stripe. Dev-only: the route 404s in production builds.

export const metadata = { title: "Pricing: dev gallery" };

export default function PricingDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PricingGallery
      banners={
        <div className="space-y-2">
          <PlanStatusBanner pastDuePlan="pro" audience="owner" />
          <PlanStatusBanner pastDuePlan="starter" audience="member" />
        </div>
      }
    />
  );
}
