import type { Metadata } from "next";
import { getProfile, getUser } from "@/lib/auth/session";
import { listStorefronts } from "@/lib/storefront/queries";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { StorefrontsList } from "@/components/storefront/StorefrontsList";

export const metadata: Metadata = {
  title: "Storefronts",
};

// Auth is enforced by storefront/layout.tsx. This page wears the dashboard
// shell (sidebar) so it reads as a normal section; the editor route does not.
export default async function StorefrontsPage() {
  const [user, profile, storefronts] = await Promise.all([
    getUser(),
    getProfile(),
    listStorefronts(),
  ]);
  const username =
    profile?.display_name || user?.email?.split("@")[0] || "Account";

  return (
    <DashboardShell username={username}>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
            Storefronts
          </h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Each storefront is its own grid and theme. Create as many as you
            need, then open one to edit it.
          </p>
        </div>

        <StorefrontsList storefronts={storefronts} />
      </main>
    </DashboardShell>
  );
}
