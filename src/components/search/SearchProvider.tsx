"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePendingRouter } from "@/lib/hooks/usePendingRouter";
import { useNavigationBlocker } from "@/lib/hooks/useNavigationBlocker";
import {
  fetchSnapshot,
  getCachedSnapshot,
} from "@/lib/search/snapshot-cache";
import type { SearchSnapshot } from "@/lib/search/types";
import type { TeamRole } from "@/lib/team/permissions";

/**
 * Owns the universal search bar's open/closed state, registers the ONE global
 * Cmd/Ctrl+K listener, pre-warms the entity snapshot, and mounts the palette.
 *
 * NESTED PROVIDERS NO-OP. Two mount points want search -- the dashboard shell
 * (which wraps the dashboard, settings and the storefront list) and the
 * full-screen storefront designer, which deliberately renders outside that
 * shell. Rather than reason about which ancestor is present on which route,
 * a provider that finds one above it simply steps aside. Placement is then
 * forgiving, and a route can never end up with two Cmd/K listeners fighting.
 *
 * SNAPSHOT WARM-UP. The snapshot is NOT pre-fetched on mount anymore; a 800 ms
 * timer on every full page load was costing one /api/search/snapshot Worker
 * invocation per navigation even when the person never opened search. Instead:
 *
 *   - Triggers call warm() on pointer-enter and focus. This preloads the
 *     overlay's JS chunk only (see warm below for why not the snapshot).
 *   - An effect on isOpen fetches (or SWR-serves) the snapshot the moment
 *     the palette opens. This covers both the button-click path (through
 *     open()) and the Cmd/K toggle, which calls setIsOpen directly.
 *   - The 5-minute TTL in snapshot-cache.ts means a stale hit returns the
 *     old data immediately and refreshes behind, so the palette opens
 *     instantly even when the index is due for a refresh.
 *
 * OVERLAY CODE SPLITTING. SearchOverlay is lazy-loaded (next/dynamic, ssr:
 * false) and rendered only after the first open (hasOpened flag). This keeps
 * lib/search/registry.ts, the rank/fuzzy/vocabulary utilities, and
 * lib/storefront/setting-ref.ts out of the shell's first-paint JS. The
 * component stays mounted after first open so its reset-on-close effect still
 * works (SearchOverlay.tsx returns null when closed).
 */

// Lazy-loaded so the ~40 KB of search registry + utilities are only parsed
// after the user first opens the palette, not on every dashboard page load.
const SearchOverlay = dynamic(
  () =>
    import("@/components/search/SearchOverlay").then((m) => m.SearchOverlay),
  { ssr: false },
);

type SearchContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** A trigger announces the element the panel should attach under. Returns
   *  the unregister cleanup. Several triggers may register (desktop bar,
   *  mobile header, designer toolbar); whichever is VISIBLE when the palette
   *  opens becomes the anchor. */
  registerAnchor: (el: HTMLElement | null) => () => void;
  /** Preloads the overlay's JS chunk. Called from pointer-enter / focus on
   *  search triggers so the first open draws at once. */
  warm: () => void;
};

const SearchContext = React.createContext<SearchContextValue | null>(null);

/**
 * Read the search controls. Returns null outside a provider, so a trigger on a
 * page without search renders inert rather than crashing the page around it.
 */
export function useSearch(): SearchContextValue | null {
  return React.useContext(SearchContext);
}

export function SearchProvider({
  children,
  role = null,
  accountId = null,
  navigate,
}: {
  children: React.ReactNode;
  /** Active account role, for hiding actions this member cannot perform. */
  role?: TeamRole | null;
  /** Active account id -- the snapshot cache key. Server-derived (the shell and
   *  the designer page both resolve it via getActiveAccount), so it can only
   *  ever name an account this user is allowed to act as. Null skips the
   *  snapshot entirely. */
  accountId?: string | null;
  /** Override navigation -- the designer routes it through its unsaved-changes
   *  guard so opening a search result cannot silently discard canvas edits. */
  navigate?: (href: string) => void;
}) {
  const existing = React.useContext(SearchContext);
  const router = usePendingRouter();
  const [isOpen, setIsOpen] = React.useState(false);
  // hasOpened gates the SearchOverlay mount so its ~40 KB bundle is only
  // evaluated after the first open, never on the initial page load.
  const [hasOpened, setHasOpened] = React.useState(false);
  // Seeded from the module cache so a provider REMOUNT (route-group hop,
  // account switch) starts with data instead of a null flash.
  const [snapshot, setSnapshot] = React.useState<SearchSnapshot | null>(() =>
    accountId ? getCachedSnapshot(accountId) : null,
  );

  // Fetch (or SWR-serve) the snapshot whenever the palette opens. This covers
  // both the button-click path through open() and the direct setIsOpen() toggle
  // in the Cmd/K keyboard handler -- that handler bypasses open() so the fetch
  // must live in an effect rather than inside open() itself.
  React.useEffect(() => {
    if (!isOpen || !accountId) return;
    let active = true;
    void fetchSnapshot(accountId).then((data) => {
      if (active && data) setSnapshot(data);
    });
    return () => {
      active = false;
    };
  }, [isOpen, accountId]);

  // Anchor registry for the "expands under the bar" layout. A Set because
  // three triggers exist (desktop bar, mobile header, designer toolbar) and
  // mount order is not knowable; visibility at open time decides. The rect is
  // STATE, not a ref: the overlay renders from it, and reading a ref during
  // render is exactly what the hooks lint rule forbids.
  const anchorsRef = React.useRef<Set<HTMLElement>>(new Set());
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);

  const registerAnchor = React.useCallback((el: HTMLElement | null) => {
    if (!el) return () => {};
    const anchors = anchorsRef.current;
    anchors.add(el);
    return () => {
      anchors.delete(el);
    };
  }, []);

  // Capture the anchor rect in the OPENING event handler, where the DOM is
  // settled -- never during render. Anchoring is a desktop idea: below sm the
  // palette is a full-screen sheet, so no rect is taken (matchMedia, not
  // innerWidth, so a customised breakpoint only breaks in one place).
  const captureAnchorRect = React.useCallback(() => {
    if (!window.matchMedia("(min-width: 640px)").matches) {
      setAnchorRect(null);
      return;
    }
    const visible = [...anchorsRef.current].find(
      (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0,
    );
    setAnchorRect(visible?.getBoundingClientRect() ?? null);
  }, []);

  const open = React.useCallback(() => {
    captureAnchorRect();
    setIsOpen(true);
    setHasOpened(true);
    // The isOpen effect above handles the snapshot fetch; calling fetchSnapshot
    // here too would double-trigger the first request on button-click opens.
  }, [captureAnchorRect]);
  const close = React.useCallback(() => setIsOpen(false), []);

  /**
   * Pre-warm the overlay's JS chunk (a static file, free to fetch) on
   * pointer-enter and focus of the triggers, so the first open draws at once.
   *
   * NOT the snapshot. The search bar sits in the top bar of every dashboard
   * page, so a pointer merely crossing it would cost a Worker invocation and
   * the snapshot's eight database reads on every full page load: exactly the
   * cost the removed mount-time warm-up had. The snapshot is fetched when the
   * palette opens (the isOpen effect above); until it lands, the overlay shows
   * the built-in list plus live search.
   */
  const warm = React.useCallback(() => {
    void import("@/components/search/SearchOverlay");
  }, []);

  // Read the latest navigate through a ref so passing an inline arrow (which
  // every call site does) doesn't re-register the shortcut on every render.
  const navigateRef = React.useRef(navigate);
  React.useEffect(() => {
    navigateRef.current = navigate;
  });
  // The navigation blocker is null outside the dashboard layout, and is a
  // no-op when no editor has registered a blocker, so this falls through to
  // router.push in all non-editor contexts.
  const navBlocker = useNavigationBlocker();
  const go = React.useCallback(
    (href: string) => {
      if (navigateRef.current) {
        // The storefront designer passes its own navigate prop, which already
        // routes through its canvas unsaved-changes guard.
        navigateRef.current(href);
      } else if (navBlocker) {
        navBlocker.request(href, (h) => router.push(h));
      } else {
        router.push(href);
      }
    },
    [router, navBlocker],
  );

  const nested = existing !== null;
  React.useEffect(() => {
    if (nested) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      // Capture phase + preventDefault: Firefox and Chrome both bind Cmd/K to
      // the address bar, and the storefront designer binds its own Cmd-shortcuts
      // on window. Claiming it here wins over both without touching either.
      event.preventDefault();
      // Rect first: a toggle that OPENS needs an anchor, and capturing on a
      // toggle that closes is harmless (the next open overwrites it).
      captureAnchorRect();
      setIsOpen((current) => {
        const next = !current;
        if (next) setHasOpened(true);
        return next;
      });
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [nested, captureAnchorRect]);

  const value = React.useMemo(
    () => ({ isOpen, open, close, registerAnchor, warm }),
    [isOpen, open, close, registerAnchor, warm],
  );

  // An ancestor already provides search: hand the children straight through so
  // this subtree shares the one palette rather than opening a second.
  if (existing) return <>{children}</>;

  return (
    <SearchContext.Provider value={value}>
      {children}
      {hasOpened && (
        <SearchOverlay
          open={isOpen}
          onClose={close}
          role={role}
          navigate={go}
          snapshot={snapshot}
          anchorRect={anchorRect}
          anchorsRef={anchorsRef}
        />
      )}
    </SearchContext.Provider>
  );
}
