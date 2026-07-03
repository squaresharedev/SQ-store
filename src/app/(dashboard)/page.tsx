import { redirect } from "next/navigation";

// PROTECTED by (dashboard)/layout.tsx. The Overview page lives at /dashboard;
// this bare "/" segment just forwards there.
export default function DashboardHomePage() {
  redirect("/dashboard");
}
