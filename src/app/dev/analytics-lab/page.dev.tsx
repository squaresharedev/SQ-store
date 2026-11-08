import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The analytics lab: the real analytics page drawn with any mix of the
// Payments tab's chart look (components/analytics/look.ts), over sample
// stores. `?solo=1` draws just the page in the address bar, for "open as a
// full page". No account and no database. Dev-only: the route 404s in
// production builds.

export const metadata = { title: "Analytics lab: dev" };

export default async function AnalyticsLabPage({ searchParams }: { searchParams: Promise<{ solo?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { solo } = await searchParams;
  return <LabLoader solo={solo === "1"} />;
}
