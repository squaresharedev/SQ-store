import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The payments lab: redesigns of the Payments tab, tuned live over the
// simulated stories in lib/payments/scenarios.ts. `?solo=1` draws just the
// design in the address bar, for the phone preview and "open as a full page".
// No account and no database. Dev-only: the route 404s in production builds.

export const metadata = { title: "Payments lab: dev" };

export default async function PaymentsLabPage({ searchParams }: { searchParams: Promise<{ solo?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { solo } = await searchParams;
  return <LabLoader solo={solo === "1"} />;
}
