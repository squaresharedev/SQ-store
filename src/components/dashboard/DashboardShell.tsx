import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";

/**
 * The dashboard chrome: fixed left Sidebar + content offset by the rail width.
 * Extracted so pages OUTSIDE the (dashboard) route group can opt into the same
 * shell — the storefront list wears it, while the full-screen storefront editor
 * deliberately does not.
 */
export function DashboardShell({
  username,
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar username={username} />
      <div className="md:pl-64">{children}</div>
    </div>
  );
}
