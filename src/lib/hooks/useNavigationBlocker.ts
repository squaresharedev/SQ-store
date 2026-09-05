"use client";

import * as React from "react";

type BlockerFn = (href: string) => void;

type NavigationBlockerContextValue = {
  /**
   * Register a blocker that handles every navigation attempt while it is
   * armed. Returns a cleanup that unregisters it. Only one blocker at a
   * time is supported: the product form is the only unsaved-changes editor
   * in the dashboard, so stacking blockers would complicate the UX without
   * covering a real case.
   */
  register: (blocker: BlockerFn) => () => void;
  /**
   * Route a PROGRAMMATIC navigation (e.g. from the Ctrl-K search palette)
   * through the active blocker, if any, falling back to the supplied
   * `navigate` function when no blocker is registered.
   */
  request: (href: string, navigate: (href: string) => void) => void;
};

const NavigationBlockerContext =
  React.createContext<NavigationBlockerContextValue | null>(null);

/**
 * Read the navigation blocker. Returns null outside a provider, so callers
 * that are mounted in parts of the app without a provider just fall through
 * to normal navigation.
 */
export function useNavigationBlocker(): NavigationBlockerContextValue | null {
  return React.useContext(NavigationBlockerContext);
}

/**
 * DASHBOARD-LEVEL NAVIGATION GUARD.
 *
 * Mounted in the dashboard layout so that ANY link in the chrome (sidebar,
 * the "Products" back link in ProductFormView, the Ctrl-K palette) can be
 * intercepted by a dirty editor without the editor having to reach into the
 * shell's DOM.
 *
 * Two sources are covered:
 *
 *   1. Anchor clicks: a capture-phase listener on `document` intercepts every
 *      same-origin internal `<a>` click while a blocker is armed. It fires
 *      first (capture beats bubble), calls preventDefault, then hands the href
 *      to the blocker so the editor's own prompt appears instead of navigating.
 *      Modifier-clicks (Cmd/Ctrl/Shift/Alt), new-tab targets, downloads, and
 *      same-page hash links are all passed through untouched.
 *
 *   2. Programmatic navigations: callers that use `request(href, navigate)` —
 *      SearchProvider is the one that does — route through the blocker when
 *      one is registered, else fall through to the supplied navigate function.
 *
 * The existing `useUnsavedChangesGuard` in ProductForm still handles browser
 * Back and `beforeunload` (the two things we cannot intercept ourselves at the
 * application level). This provider only covers the gaps: in-app links and
 * programmatic pushes.
 */
export function NavigationBlockerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // A ref rather than state: registering a blocker should not trigger a render
  // of the whole subtree, and reading the ref in a click handler (not during
  // render) is safe.
  const blockerRef = React.useRef<BlockerFn | null>(null);

  React.useEffect(() => {
    function handleClick(event: MouseEvent) {
      const blocker = blockerRef.current;
      if (!blocker) return;
      // Modifier keys tell the browser to open a new tab, trigger browser
      // actions, etc. — let those proceed as normal.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // Only primary button clicks start navigation.
      if (event.button !== 0) return;

      const anchor = (event.target as Element).closest("a");
      if (!anchor) return;
      // Opening in a new tab or triggering a download is the browser's job.
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      try {
        const url = new URL(href, window.location.href);
        // External URLs navigate away from the SPA entirely and are not
        // transitions the blocker needs to intercept.
        if (url.origin !== window.location.origin) return;
        // Same-page hash links (e.g. the FormSectionNav's scroll jumps) are
        // not navigations — they are in-page position changes. Pass them
        // through so the section nav continues to work while a form is dirty.
        if (url.pathname === window.location.pathname && url.hash) return;
      } catch {
        // Unparseable href (e.g. "javascript:") — let the browser handle it.
        return;
      }

      event.preventDefault();
      blocker(anchor.href || href);
    }

    // Capture phase so this fires before any React onClick handler on the
    // link itself, giving us the first chance to intercept.
    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, []);

  const register = React.useCallback((blocker: BlockerFn) => {
    blockerRef.current = blocker;
    return () => {
      // Guard against a stale cleanup: only clear if THIS registration is
      // still the current one, so rapid register/unregister pairs from the
      // same component do not accidentally disarm a newer blocker.
      if (blockerRef.current === blocker) blockerRef.current = null;
    };
  }, []);

  const request = React.useCallback(
    (href: string, navigate: (href: string) => void) => {
      const blocker = blockerRef.current;
      if (blocker) {
        blocker(href);
      } else {
        navigate(href);
      }
    },
    [],
  );

  const value = React.useMemo(
    () => ({ register, request }),
    [register, request],
  );

  return React.createElement(
    NavigationBlockerContext.Provider,
    { value },
    children,
  );
}
