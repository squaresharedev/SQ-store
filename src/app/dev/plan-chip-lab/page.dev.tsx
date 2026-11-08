import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The plan chip lab (components/billing/PlanChip): twenty candidates for the rail's
// Upgrade chip, numbered, each in the rail's footer above Settings.
// No account and no database. Dev-only: the route 404s in production builds.

export const metadata = { title: "Plan chip lab: dev" };

export default function PlanChipLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabLoader />;
}
