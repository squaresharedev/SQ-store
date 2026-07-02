"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
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
    "flex shrink-0 snap-start items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    active
      ? danger
        ? "bg-red-50 text-red-600"
        : "bg-neutral-100 text-neutral-900"
      : danger
        ? "text-neutral-500 hover:bg-red-50 hover:text-red-600"
        : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900",
  );
}

/**
 * Settings page shell: header, sub-navigation (left rail on desktop,
 * horizontally scrolling tabs on mobile — the same collapse pattern as the
 * dashboard sidebar), and the content column.
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
          className="flex shrink-0 snap-start cursor-not-allowed items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-neutral-300"
        >
          <Icon aria-hidden className="size-4" />
          {item.label}
          <span className="border border-neutral-200 px-1.5 py-0.5 font-inter text-xs uppercase tracking-wide text-neutral-400">
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
    <div className="relative z-10 mx-auto w-full max-w-5xl px-6 py-10 md:py-16">
      <header className="mb-8 md:mb-12">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 font-inter text-sm text-neutral-500 transition-colors hover:text-neutral-900"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          Settings
        </h1>
        <p className="mt-1 font-inter text-sm text-neutral-500">
          Your account, your rules. Everything here is yours to change.
        </p>
      </header>

      <div className="flex flex-col gap-8 md:flex-row md:gap-12">
        {/* Mobile: horizontally scrolling tab row with a right-edge fade that
            hints at the tabs (Danger zone) sitting off-screen. Desktop: a
            static left rail with no scroll or fade. */}
        <div className="relative -mx-6 md:mx-0 md:w-52 md:shrink-0">
          <nav
            ref={navRef}
            aria-label="Settings sections"
            className="flex snap-x gap-1 overflow-x-auto scroll-px-6 border-b border-neutral-200 px-6 pb-2 md:snap-none md:flex-col md:overflow-visible md:border-0 md:px-0 md:pb-0"
          >
            {nav}
          </nav>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent md:hidden"
          />
        </div>

        <div className="min-w-0 flex-1 md:max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
