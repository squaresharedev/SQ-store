import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The Needs attention lab: the overview's to-do card redone for a phone, over
// real rows from lib/dashboard/attention.ts and fake store states. No account,
// no database. Dev-only: the route 404s in production builds.

export const metadata = { title: "Needs attention lab: dev" };

export default function AttentionLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabLoader />;
}
