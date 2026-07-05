import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getProfile, requireUser } from "@/lib/auth/session";

/**
 * PROTECTED — single auth gate for the whole route group. Layouts persist
 * across sibling navigations (Next.js does not re-render an unchanged parent
 * segment), so checking auth here — instead of in every page — means the
 * Supabase auth round-trip happens once per visit to the section, not on
 * every click between /products, /storefront, etc. Pages still get RLS as
 * the real ownership boundary; they no longer need to re-verify the session.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser("/");
  const profile = await getProfile();
  const username = profile?.display_name || user.email?.split("@")[0] || "Account";

  return <DashboardShell username={username}>{children}</DashboardShell>;
}
