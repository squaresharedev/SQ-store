import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The billing & invoices lab: Settings › Billing & invoices redone after the
// billing pages sellers know, tuned live over the fake store states in
// ../invoices/fixtures.ts. No account, no database, no Stripe. Dev-only: the
// route 404s in production builds.

export const metadata = { title: "Invoices lab: dev" };

export default function InvoicesLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabLoader />;
}
