import { notFound } from "next/navigation";
import { InvoicesGallery } from "./InvoicesGallery";

// Living reference for Settings › Billing & invoices (components/billing/
// invoices): the card in every state a store can be in, on fake Stripe data
// (invoices, a card, billing details), with stand-in links and actions. Nothing
// is bought and nothing leaves the page. No account, no database, no Stripe.
// Dev-only: the route 404s in production builds.

export const metadata = { title: "Invoices: dev gallery" };

export default function InvoicesDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  // Read here, once, so the server and the browser draw the same dates.
  return <InvoicesGallery nowIso={new Date().toISOString()} />;
}
