"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { useNavigationBlocker } from "@/lib/hooks/useNavigationBlocker";
import {
  fetchSnapshot,
  getCachedSnapshot,
} from "@/lib/search/snapshot-cache";
import type { SearchSnapshot } from "@/lib/search/types";
import type { TeamRole } from "@/lib/team/permissions";

/**
 * Owns the universal search bar's open/closed state, registers the ONE global
 * ⌘K / Ctrl+K listener, warms the entity snapshot, and mounts the palette.
 *
 * NESTED PROVIDERS NO-OP. Two mount points want search — the dashboard shell
 * (which wraps the dashboard, settings and the storefront list) and the
 * full-screen storefront designer, which deliberately renders outside that
 * shell. Rather than reason about which ancestor is present on which route,
 * a provider that finds one above it simply steps aside. Placement is then
 * forgiving, and a route can never end up with two ⌘K listeners fighting.
 *
 * THE WARM-UP matters twice over. Fetching the snapshot shortly after mount
 * puts every entity name in memory before the first keystroke, so content
 * search answers instantly; and in dev the request compiles the API route,
 * so the first real search never pays the compile inside its own deadline —
 * the exact failure reported as "search doesn't find my storefront".
 */

/** Late enough to stay out of the shell's own startup work (hydration, the
 *  notifications snapshot), early enough to beat any human to ⌘K. */
const SNAPSHOT_WARMUP_MS = 800;

type SearchContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** A trigger announces the element the panel should attach under. Returns
   *  the unregister cleanup. Several triggers may register (desktop bar,
   *  mobile header, designer toolbar); whichever is VISIBLE when the palette
   *  opens becomes the anchor. */
  registerAnchor: (el: HTMLElement | null) => () => void;
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
  /** Active account id — the snapshot cache key. Server-derived (the shell and
   *  the designer page both resolve it via getActiveAccount), so it can only
   *  ever name an account this user is allowed to act as. Null skips the
   *  snapshot entirely. */
  accountId?: string | null;
  /** Override navigation — the designer routes it through its unsaved-changes
   *  guard so opening a search result cannot silently discard canvas edits. */
  navigate?: (href: string) => void;
}) {
  const existing = React.useContext(SearchContext);
  const router = useRouter();
  const [isOpen, setIsOpen] = React.useState(false);
  // Seeded from the module cache so a provider REMOUNT (route-group hop,
  // account switch) starts with data instead of a null flash.
  const [snapshot, setSnapshot] = React.useState<SearchSnapshot | null>(() =>
    accountId ? getCachedSnapshot(accountId) : null,
  );

  // Warm the snapshot shortly after mount. All the cache/SWR logic lives in
  // the module; this effect only ferries the result into state.
  React.useEffect(() => {
    if (!accountId) return;
    let active = true;
    const timer = setTimeout(() => {
      void fetchSnapshot(accountId).then((data) => {
        if (active && data) setSnapshot(data);
      });
    }, SNAPSHOT_WARMUP_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accountId]);

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
  // settled — never during render. Anchoring is a desktop idea: below sm the
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
    // Opening is also the moment freshness matters: serve what we have,
    // refresh behind if the TTL has lapsed (the cache dedupes and decides).
    if (accountId) {
      void fetchSnapshot(accountId).then((data) => {
        if (data) setSnapshot(data);
      });
    }
  }, [accountId, captureAnchorRect]);
  const close = React.useCallback(() => setIsOpen(false), []);

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
      // Capture phase + preventDefault: Firefox and Chrome both bind ⌘K to the
      // address bar, and the storefront designer binds its own ⌘-shortcuts on
      // window. Claiming it here wins over both without touching either.
      event.preventDefault();
      // Rect first: a toggle that OPENS needs an anchor, and capturing on a
      // toggle that closes is harmless (the next open overwrites it).
      captureAnchorRect();
      setIsOpen((current) => !current);
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [nested, captureAnchorRect]);

  const value = React.useMemo(
    () => ({ isOpen, open, close, registerAnchor }),
    [isOpen, open, close, registerAnchor],
  );

  // An ancestor already provides search: hand the children straight through so
  // this subtree shares the one palette rather than opening a second.
  if (existing) return <>{children}</>;

  return (
    <SearchContext.Provider value={value}>
      {children}
      <SearchOverlay
        open={isOpen}
        onClose={close}
        role={role}
        navigate={go}
        snapshot={snapshot}
        anchorRect={anchorRect}
        anchorsRef={anchorsRef}
      />
    </SearchContext.Provider>
  );
}
