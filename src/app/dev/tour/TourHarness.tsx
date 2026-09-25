"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Code, Menu, Search } from "lucide-react";
import { TourOverlay } from "@/components/onboarding/TourOverlay";
import { TourReplayCard } from "@/components/onboarding/TourReplayCard";
import { OrdersToolbar } from "@/components/orders/OrdersToolbar";
import { ConnectionStatusCard } from "@/components/payments/ConnectionStatusCard";
import { Button } from "@/components/ui/button";
import {
  focusRingClass,
  ghostButtonClass,
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { tourStepsFor } from "@/lib/onboarding/tour-steps";
import { startTour, useTour, useTourReveal } from "@/lib/onboarding/tour-store";
import { can, type TeamRole } from "@/lib/team/permissions";
import { cn } from "@/lib/utils";

type Delay = "instant" | "slow" | "never";

const DELAY_MS: Record<Delay, number | null> = { instant: 0, slow: 1500, never: null };

const PAGES: { path: string; label: string }[] = [
  { path: "/dashboard", label: "Overview" },
  { path: "/products", label: "Products" },
  { path: "/storefront", label: "Storefront" },
  { path: "/orders", label: "Orders" },
  { path: "/analytics", label: "Analytics" },
  { path: "/payments", label: "Payments" },
  { path: "/settings/account", label: "Settings" },
];

const NOT_CONNECTED = {
  connected: false,
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  requirementsDue: [],
};

/** Room above a control, so the tour has something to scroll past. */
function Filler({ lines = 12 }: { lines?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="h-10 border border-border bg-muted/40" />
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  name,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  name: string;
}) {
  return (
    <label className="flex items-center gap-2 font-inter text-sm text-foreground">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/**
 * The guided tour over fixture pages. Pathname and navigation are state here,
 * handed to the overlay the same way tests inject them, so a "page" change is
 * instant, slow (1.5s, to see "Opening…"), or never happens.
 *
 * Every fixture renders the SAME selector the real page does (see
 * lib/onboarding/tour-steps.ts): the sidebar uses the real rail's translate
 * classes, so on a phone it is off screen exactly like the real one.
 */
export function TourHarness() {
  const [pathname, setPathname] = useState("/dashboard");
  const [role, setRole] = useState<TeamRole>("owner");
  const [delay, setDelay] = useState<Delay>("instant");
  const [hasStorefront, setHasStorefront] = useState(false);
  const [hasSample, setHasSample] = useState(true);
  const [hasOrders, setHasOrders] = useState(false);
  const [analyticsFirstRun, setAnalyticsFirstRun] = useState(true);
  const tour = useTour();
  const tourShowsToolbar = useTourReveal("orders-toolbar");
  const steps = useMemo(() => tourStepsFor(role), [role]);
  const canWriteProducts = can(role, "products.write");
  const canWriteStorefront = can(role, "storefront.write");

  const goTo = useCallback((path: string) => {
    setPathname(path);
    window.scrollTo({ top: 0 });
  }, []);

  const navigate = useCallback(
    (path: string) => {
      const ms = DELAY_MS[delay];
      if (ms === null) return;
      if (ms === 0) goTo(path);
      else setTimeout(() => goTo(path), ms);
    },
    [delay, goTo],
  );

  const pageLabel = PAGES.find((page) => page.path === pathname)?.label ?? "Somewhere else";
  let page: ReactNode;

  if (pathname === "/dashboard") {
    page = (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Overview (fixture)</h1>
        <section
          aria-label="Harness controls"
          className="space-y-3 border border-border bg-background p-4"
        >
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-inter text-sm text-foreground">
              Role
              <select
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value as TeamRole)}
                className="border border-border bg-background px-2 py-1"
              >
                <option value="owner">owner</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <label className="flex items-center gap-2 font-inter text-sm text-foreground">
              Navigation
              <select
                name="delay"
                value={delay}
                onChange={(event) => setDelay(event.target.value as Delay)}
                className="border border-border bg-background px-2 py-1"
              >
                <option value="instant">instant</option>
                <option value="slow">slow (1.5s)</option>
                <option value="never">never arrives</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <Toggle
              name="has-storefront"
              label="Has a storefront"
              checked={hasStorefront}
              onChange={setHasStorefront}
            />
            <Toggle
              name="has-sample"
              label="Sample storefront shown"
              checked={hasSample}
              onChange={setHasSample}
            />
            <Toggle name="has-orders" label="Has orders" checked={hasOrders} onChange={setHasOrders} />
            <Toggle
              name="analytics-first-run"
              label="Analytics first run"
              checked={analyticsFirstRun}
              onChange={setAnalyticsFirstRun}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              data-harness-start=""
              onClick={() => startTour({ next: { href: "/products/new", label: "Add your first product" } })}
            >
              Start the tour
            </Button>
            <Button variant="secondary" onClick={() => startTour()}>
              Start without a next step
            </Button>
          </div>
        </section>
        <Filler lines={6} />
      </div>
    );
  } else if (pathname === "/products") {
    page = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">Products (fixture)</h1>
          {canWriteProducts && (
            <div className="flex gap-2">
              <a
                href="/products/import"
                onClick={(event) => event.preventDefault()}
                className={cn(secondaryButtonClass, "h-10 px-3 py-2")}
              >
                Import
              </a>
              <a
                href="/products/new"
                onClick={(event) => event.preventDefault()}
                className={cn(primaryButtonClass, "h-10")}
              >
                Add product
              </a>
            </div>
          )}
        </div>
        <Filler lines={8} />
      </div>
    );
  } else if (pathname === "/storefront") {
    page = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">Storefronts (fixture)</h1>
          {canWriteStorefront && (
            <Button data-tour="storefront-create">New storefront</Button>
          )}
        </div>
        <Filler lines={14} />
        {hasStorefront && (
          <div className="relative h-48 border border-border bg-muted/40">
            {canWriteStorefront && (
              <div className="absolute right-3 top-3 flex gap-1.5">
                <button
                  type="button"
                  data-tour="storefront-embed"
                  aria-label="Embed Demo storefront"
                  className={iconButtonClass}
                >
                  <Code className="size-4" aria-hidden />
                </button>
              </div>
            )}
            <p className="p-4 font-inter text-sm text-muted-foreground">Demo storefront</p>
          </div>
        )}
        {hasSample && canWriteStorefront && (
          // The sample's quiet link, after the seller's own like the real list
          // (StorefrontsList), with the attribute on the wrapper that hugs it.
          <div className="flex justify-center">
            <span data-storefront-sample="" className="inline-flex">
              <Link
                href="/storefront/sample"
                onClick={(event) => event.preventDefault()}
                className={cn(ghostButtonClass, "px-3 py-2")}
              >
                Open the sample storefront
              </Link>
            </span>
          </div>
        )}
      </div>
    );
  } else if (pathname === "/orders") {
    page = (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Orders (fixture)</h1>
        {(hasOrders || tourShowsToolbar) && (
          <OrdersToolbar
            filters={{}}
            onChange={() => {}}
            sort={{ field: "createdAt", direction: "desc" }}
            onSortChange={() => {}}
          />
        )}
        <Filler lines={6} />
      </div>
    );
  } else if (pathname === "/analytics") {
    page = (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Analytics (fixture)</h1>
        {analyticsFirstRun ? (
          <div data-analytics-range-preset="30d" data-analytics-first-run="1">
            <div className="border border-border p-10 text-center font-inter text-sm text-muted-foreground">
              Nothing to measure yet
            </div>
          </div>
        ) : (
          <div data-analytics-range-preset="30d" data-tour="analytics-range" className="space-y-6">
            <div role="group" aria-label="Date range" className="inline-flex border border-border">
              <button type="button" aria-pressed="true" className={cn("px-3 py-2 text-sm", focusRingClass)}>
                Last 30 days
              </button>
              <button type="button" aria-pressed="false" className={cn("px-3 py-2 text-sm", focusRingClass)}>
                All time
              </button>
            </div>
            <Filler lines={6} />
          </div>
        )}
      </div>
    );
  } else if (pathname === "/payments") {
    page = (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Payments (fixture)</h1>
        <Filler lines={10} />
        <ConnectionStatusCard account={NOT_CONNECTED} onConnect={() => {}} />
      </div>
    );
  } else if (pathname === "/settings/account") {
    page = (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl font-semibold text-foreground">Account (fixture)</h1>
        <Filler lines={10} />
        <div id="tour">
          <TourReplayCard />
        </div>
      </div>
    );
  } else {
    page = (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Somewhere else</h1>
        <Button variant="secondary" onClick={() => goTo("/dashboard")}>
          Back to Overview
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-harness-path={pathname}>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background px-4 md:hidden">
        <button
          type="button"
          data-tour="menu-button"
          aria-label="Open menu"
          className={cn(iconButtonClass, "size-10 border-0")}
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <span className="font-medium text-foreground">{pageLabel}</span>
        <div className="ml-auto">
          <button
            type="button"
            data-tour="search-phone"
            aria-label="Search"
            className={cn(iconButtonClass, "size-10 border-0")}
          >
            <Search className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      {/* Same translate classes as the real rail: on a phone it is off screen. */}
      <nav
        data-tour="dashboard-nav"
        aria-label="Dashboard"
        className="fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col gap-1 border-r border-border bg-background p-4 md:translate-x-0"
      >
        {PAGES.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => goTo(item.path)}
            aria-current={item.path === pathname ? "page" : undefined}
            className={cn(
              "px-3 py-2 text-left text-sm",
              item.path === pathname ? "bg-accent font-medium" : "text-muted-foreground",
              focusRingClass,
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="md:pl-64">
        <div
          data-testid="top-bar"
          className="sticky top-0 z-20 hidden h-14 items-center border-b border-border bg-background px-6 md:flex"
        >
          <button
            type="button"
            aria-keyshortcuts="Meta+K Control+K"
            className={cn(secondaryButtonClass, "h-9 w-64 justify-start px-3 py-1.5")}
          >
            <Search className="size-4" aria-hidden />
            Search
          </button>
        </div>
        <main className="mx-auto max-w-5xl px-6 py-8">{page}</main>
      </div>

      {/* Above the tour's layer: a person leaving the page mid-tour. */}
      {tour.status === "active" && (
        <button
          type="button"
          data-harness-leave=""
          onClick={() => goTo("/somewhere-else")}
          className={cn(secondaryButtonClass, "fixed right-2 top-16 z-[66] px-2 py-1 text-xs")}
        >
          Leave page
        </button>
      )}

      <TourOverlay role={role} steps={steps} pathname={pathname} navigate={navigate} />
    </div>
  );
}
