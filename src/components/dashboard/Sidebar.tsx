"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { focusRingClass, overlayScrimClass, transitionClass } from "@/components/ui/control-styles";
import {
  MAIN_NAV,
  SETTINGS_LINK,
  type NavEntry,
} from "@/lib/search/nav-constants";

// The nav map itself lives in @/lib/search/nav-constants so the universal
// search registry indexes exactly what this rail renders.
type NavLink = NavEntry;

// The nav row is the animation trigger: switching the variant label here
// propagates "hover" down to the icon's motion sub-elements, so hovering the
// text animates the glyph too. Tap covers touch, focus covers keyboards.
// Reduced-motion users never receive the label, so icons stay static.
const MotionLink = motion.create(Link);

function useNavAnimationProps(): Record<string, string> {
  const reducedMotion = useReducedMotion();
  return reducedMotion
    ? { initial: "idle" as const }
    : {
        initial: "idle" as const,
        whileHover: "hover" as const,
        whileTap: "hover" as const,
        whileFocus: "hover" as const,
      };
}

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

// Nav rows keep a radius (the brand rule squares buttons and overlays, not
// in-page navigation), and share the app's motion + focus tokens so they read
// as one family of controls with the mobile menu toggle.
const NAV_ITEM_CLASSES = cn(
  "flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm font-medium",
  transitionClass,
  focusRingClass,
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
  const animationProps = useNavAnimationProps();
  const [hoverCount, setHoverCount] = useState(0);
  const countHover = () => setHoverCount((count) => count + 1);
  return (
    <MotionLink
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      {...animationProps}
      // Plain component state, for the icons whose story is a one-shot that
      // must not rewind when the pointer leaves (see NavIconProps.hoverCount).
      // Only the starts are counted: nothing here has to be cleared, so a
      // missed pointer-leave cannot wedge the next hover.
      onHoverStart={countHover}
      onFocus={countHover}
      className={cn(
        NAV_ITEM_CLASSES,
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon hoverCount={hoverCount} />
      {item.label}
    </MotionLink>
  );
}


export function Sidebar({
  topBarSlot,
}: {
  /**
   * Optional controls rendered at the right of the mobile top bar, beside the
   * hamburger row (the dashboard shell passes the notification bell + profile
   * menu here). Left undefined by other consumers (e.g. settings).
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
    // Belt and braces under the useNavAnimationProps gate: even an animation
    // that slips past the per-row check gets its transforms suppressed for
    // reduced-motion users at the motion-runtime level.
    <MotionConfig reducedMotion="user">
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
            "flex size-10 items-center justify-center rounded-sm text-foreground hover:bg-accent",
            transitionClass,
            focusRingClass,
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

        {/* Right cluster: the shared top-bar slot (notification bell + menu). */}
        <div className="ml-auto shrink-0">{topBarSlot}</div>
      </header>

      {/* Dimmed backdrop, mobile drawer mode only. */}
      {isOpen && (
        <div
          aria-hidden="true"
          onClick={closeDrawer}
          className={cn(overlayScrimClass, "z-40 md:hidden")}
        />
      )}

      <nav
        id={navId}
        ref={navRef}
        tabIndex={-1}
        aria-label="Dashboard"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-background",
          "transition-transform duration-slow ease-entrance motion-reduce:transition-none",
          "md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand row: logo + product name. Fixed to the top-bar height (h-14)
            so its bottom hairline lines up with the notification bar's across
            the rail seam. */}
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- static public asset; next/image adds no value here. */}
          <img
            src="/img/logo.png"
            alt="Square Share"
            className="size-6 shrink-0 rounded-sm object-contain"
          />
          <span className="truncate text-lg font-semibold tracking-tight text-foreground">
            Dashboard
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
        </div>
      </nav>
    </MotionConfig>
  );
}
