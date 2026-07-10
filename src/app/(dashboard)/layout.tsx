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
 *
 * force-dynamic: relying on cookies() (inside requireUser) to auto-opt this
 * route into dynamic rendering is not reliable here — the Supabase client
 * guard throws on missing env vars *before* it ever calls cookies(), so if
 * NEXT_PUBLIC_SUPABASE_* is unset at build time, Next never sees a Dynamic
 * API call and silently prerenders this section statically, baking the
 * auth failure into the static HTML for every subsequent request.
 */
export const dynamic = "force-dynamic";
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
