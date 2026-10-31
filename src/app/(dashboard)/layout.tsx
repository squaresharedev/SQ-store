import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { StepUpProvider } from "@/components/auth/StepUp";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { stepUpProviderProps } from "@/lib/auth/assurance";
import { getAssurance, getProfile, requireUser } from "@/lib/auth/session";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";
import { NavigationBlockerProvider } from "@/lib/hooks/useNavigationBlocker";

/**
 * PROTECTED: the auth gate for arriving in the route group. Layouts persist
 * across sibling navigations (Next.js does not re-render an unchanged parent
 * segment), so this runs once per visit to the section, not on every click
 * between /products, /orders, etc.
 *
 * WHICH IS WHY EVERY PAGE BELOW ALSO CALLS requireUser. With the gate here
 * alone, a session that ended elsewhere (a password changed on another device,
 * two-factor switched on, a sign-out in another tab) was never noticed on a
 * move between sections: RLS answered every read with nothing, and the seller
 * was shown "No orders yet" where the truth was "you are signed out". A page
 * does render on each move, so the page asks. It costs no extra round trip:
 * its own reads already go through the same cached session lookup in the same
 * request. (A template.tsx here does NOT work: its server half renders with
 * this layout, not with the page. tests/e2e/85-dead-ends.spec.ts pins it.)
 * A NEW PAGE IN THIS GROUP MUST DO THE SAME.
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
  const [profile, assurance] = await Promise.all([getProfile(), getAssurance()]);
  const t = await getTranslations("Dashboard.shell");
  const username = profile?.username || user.email?.split("@")[0] || t("accountFallback");

  // Toasts come from the ROOT layout (app/layout.tsx), not from here: they
  // have to outlive a navigation out of this route group.
  //
  // NavigationBlockerProvider sits above DashboardShell so it is an ancestor
  // of both SearchProvider (which calls request() for programmatic navigations)
  // and ProductForm (which calls register() while it has unsaved edits). The
  // provider installs one capture-phase click listener on document, so every
  // internal link in the chrome — sidebar, back links, breadcrumbs — goes
  // through the active blocker when a dirty editor is mounted.
  //
  // StepUpProvider: the step-up forms in this group (the welcome flow, the plan
  // buttons) have to know what the account confirms with (components/auth/StepUp.tsx).
  return (
    <ScopedIntlProvider scope="app">
      <NavigationBlockerProvider>
        <StepUpProvider {...stepUpProviderProps(assurance)}>
          <DashboardShell username={username}>{children}</DashboardShell>
        </StepUpProvider>
      </NavigationBlockerProvider>
    </ScopedIntlProvider>
  );
}
