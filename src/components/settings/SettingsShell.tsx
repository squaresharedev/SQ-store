"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Receipt,
  ScrollText,
  TriangleAlert,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/settings/account", label: "Account", icon: User },
  { href: "/settings/legal", label: "Legal", icon: ScrollText },
  { href: "/settings/tax", label: "Tax", icon: Receipt },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  // Team & access is a separate slice; its /settings/team route isn't built
  // yet, so the entry renders disabled instead of 404ing.
  { href: "/settings/team", label: "Team & access", icon: Users, soon: true },
  { href: "/settings/danger", label: "Danger zone", icon: TriangleAlert, danger: true },
] as const;

function navItemClasses(active: boolean, danger?: boolean) {
  return cn(
    "flex shrink-0 snap-start items-center gap-2.5 rounded-[0.375rem] px-3 py-2.5 text-sm font-medium",
    "transition-colors duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    active
      ? danger
        ? "bg-red-50 text-red-600"
        : "bg-accent text-foreground"
      : danger
        ? "text-muted-foreground hover:bg-red-50 hover:text-red-600"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

/**
 * Settings sub-navigation. Renders as a second sidebar sitting flush against
 * the main dashboard rail on desktop (a full-height sticky column), and
 * collapses to a horizontally scrolling tab row under the mobile top bar,
 * the same collapse pattern as the dashboard sidebar itself.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navRef = React.useRef<HTMLElement>(null);

  // On mobile the sub-nav scrolls horizontally, so the active tab can start
  // off-screen (e.g. landing on Danger zone). Nudge it into view on route
  // change. Instant scroll respects reduced-motion by construction.
  React.useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    active?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  const nav = NAV.map((item) => {
    const active = pathname.startsWith(item.href);
    const Icon = item.icon;
    const soon = "soon" in item && item.soon;
    const danger = "danger" in item && item.danger;

    if (soon) {
      return (
        <span
          key={item.href}
          aria-disabled
          title="Coming soon"
          className="flex shrink-0 snap-start cursor-not-allowed items-center gap-2.5 rounded-[0.375rem] px-3 py-2.5 text-sm font-medium text-muted-foreground opacity-50"
        >
          <Icon aria-hidden className="size-4" />
          {item.label}
          <span className="rounded-sm border border-border px-1.5 py-0.5 font-inter text-xs uppercase tracking-wide text-muted-foreground">
            soon
          </span>
        </span>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={navItemClasses(active, danger)}
      >
        <Icon aria-hidden className="size-4" />
        {item.label}
      </Link>
    );
  });

  return (
    <div className="md:flex md:items-stretch">
      {/* Settings secondary sidebar. Full-height sticky rail on desktop, a
          scrolling tab strip on mobile. */}
      <aside className="md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-border">
        <div className="px-6 pt-6 md:px-4 md:pt-8">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Your account, your rules.
          </p>
        </div>
        <div className="relative mt-4 md:mt-6">
          <nav
            ref={navRef}
            aria-label="Settings sections"
            className="flex snap-x gap-1 overflow-x-auto scroll-px-6 border-b border-border px-6 pb-2 md:snap-none md:flex-col md:gap-0.5 md:overflow-visible md:border-0 md:px-3 md:pb-6"
          >
            {nav}
          </nav>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent md:hidden"
          />
        </div>
      </aside>

      {/* Content column. */}
      <div className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-12">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
