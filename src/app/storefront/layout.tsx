import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";

/**
 * PROTECTED — single auth gate for the whole storefront section (list + editor).
 * Deliberately OUTSIDE the (dashboard) route group: the editor at
 * /storefront/[id] renders full-screen without the sidebar, so the sidebar
 * cannot live in a shared ancestor layout. The list page renders the dashboard
 * shell itself instead. Auth runs once here; pages still get RLS as the real
 * ownership boundary.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireUser("/storefront");
  return children;
}
