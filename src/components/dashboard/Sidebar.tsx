"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Compass,
  CreditCard,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Settings,
  ShoppingCart,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { iconPopClass, primaryButtonClass } from "@/components/ui/control-styles";
import { SquareShareLogo } from "@/components/ui/square-share-logo";

type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const MAIN_NAV: NavLink[] = [
  // The Overview page lives at /dashboard ("/" merely redirects there);
  // linking it directly keeps the active state working and skips the hop.
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Products", href: "/products", icon: Package },
  { label: "Storefront", href: "/storefront", icon: Store },
  { label: "Orders", href: "/orders", icon: ShoppingCart },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Payments", href: "/payments", icon: CreditCard },
];

const SETTINGS_LINK: NavLink = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
};

function isNavLinkActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Title shown in the mobile top bar — the active nav item's label. */
function mobileTitle(pathname: string): string | null {
  const item = [...MAIN_NAV, SETTINGS_LINK].find((link) =>
    isNavLinkActive(pathname, link.href),
  );
  return item?.label ?? null;
}

// Shared with the mobile menu-toggle button so hover/focus/motion read as one
// family of controls.
const CONTROL_TRANSITION = cn(
  "transition-colors duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
  "motion-reduce:transition-none",
);

const FOCUS_RING = cn(
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

const NAV_ITEM_CLASSES = cn(
  "flex items-center gap-2 rounded-[0.375rem] px-3 py-2.5 text-sm font-medium",
  CONTROL_TRANSITION,
  FOCUS_RING,
);

function NavLinkItem({
  item,
  pathname,
  onNavigate,
}: {
  item: NavLink;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isNavLinkActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        NAV_ITEM_CLASSES,
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {item.label}
    </Link>
  );
}

export function Sidebar({
  username,
  topBarSlot,
}: {
  username: string;
  /**
   * Optional control rendered at the right of the mobile top bar, beside the
   * hamburger row (the dashboard shell passes the notification bell here). Left
   * undefined by other consumers (e.g. settings), which then render no slot.
   */
  topBarSlot?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navId = useId();

  // Route changes (including a nav-link click) always close the mobile
  // drawer. Adjusted during render (React's documented pattern for resetting
  // state on a prop change) rather than in an effect, since an unconditional
  // setState in an effect would trigger an extra cascading render every time.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setIsOpen(false);
  }

  // Esc closes the drawer and hands focus back to the toggle button.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        toggleButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Opening the drawer moves focus into it and locks background scroll.
  useEffect(() => {
    if (!isOpen) return;
    navRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
    toggleButtonRef.current?.focus();
  }

  return (
    <>
      {/* Mobile-only top bar: menu toggle + current page title (+ the Add
          quick action on Overview). Hidden entirely at the md breakpoint,
          where the sidebar is always visible instead. Overview drops the
          bottom hairline so its hero bloom meets the bar seamlessly. */}
      <header
        className={cn(
          "sticky top-0 z-30 flex h-14 items-center gap-2 bg-background px-4 md:hidden",
          !isNavLinkActive(pathname, "/dashboard") && "border-b border-border",
        )}
      >
        <button
          ref={toggleButtonRef}
          type="button"
          aria-label={isOpen ? "Close menu" : "Open menu"}
          aria-expanded={isOpen}
          aria-controls={navId}
          onClick={() => setIsOpen((open) => !open)}
          className={cn(
            "flex size-10 items-center justify-center rounded-[0.375rem] text-foreground hover:bg-accent",
            CONTROL_TRANSITION,
            FOCUS_RING,
          )}
        >
          {isOpen ? (
            <X className="size-5" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Menu className="size-5" strokeWidth={2} aria-hidden="true" />
          )}
        </button>

        <span className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground">
          {mobileTitle(pathname)}
        </span>

        {/* Right cluster: the (Overview-only) add shortcut, then the shared
            top-bar slot (notification bell). */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isNavLinkActive(pathname, "/dashboard") && (
            <Link
              href="/products/new"
              aria-label="Add product"
              className={cn(primaryButtonClass, "size-10 shrink-0 p-0")}
            >
              <Plus
                className={cn("size-5", iconPopClass)}
                strokeWidth={2}
                aria-hidden="true"
              />
            </Link>
          )}
          {topBarSlot}
        </div>
      </header>

      {/* Dimmed backdrop, mobile drawer mode only. */}
      {isOpen && (
        <div
          aria-hidden="true"
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <nav
        id={navId}
        ref={navRef}
        tabIndex={-1}
        aria-label="Dashboard"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-background",
          "transition-transform duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          "md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand row: logo + signed-in user. Extra bottom padding + a border
            give it more room than the nav rows below, so it reads as its own
            header rather than just the first item in the list. */}
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-5">
          <SquareShareLogo className="size-6 shrink-0 text-foreground" />
          <span className="truncate text-sm font-medium text-foreground">
            {username}
          </span>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {MAIN_NAV.map((item) => (
            <NavLinkItem
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={closeDrawer}
            />
          ))}
        </div>

        <div className="space-y-1 border-t border-border px-3 py-4">
          <NavLinkItem
            item={SETTINGS_LINK}
            pathname={pathname}
            onNavigate={closeDrawer}
          />

          <div
            aria-disabled="true"
            className={cn(
              NAV_ITEM_CLASSES,
              "cursor-not-allowed justify-between text-muted-foreground opacity-50",
            )}
          >
            <span className="flex items-center gap-2">
              <Compass className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
              Discover
            </span>
            <span className="font-inter text-xs text-muted-foreground">
              Coming soon
            </span>
          </div>
        </div>
      </nav>
    </>
  );
}
