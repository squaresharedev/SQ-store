import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { requireUser } from "@/lib/auth/session";

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
  await requireUser("/");

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="md:pl-64">{children}</div>
    </div>
  );
}
