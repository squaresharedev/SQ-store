"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Intercept attempts to leave the storefront editor while it has unsaved edits,
 * so the caller can offer save / discard / keep-editing instead of silently
 * losing work. Covers the three ways out of a full-screen editor:
 *
 *   1. In-app links (the header "Back") — route them through `requestLeave`,
 *      which opens the prompt when dirty and navigates straight through when not.
 *   2. The browser Back button — a sentinel history entry is pushed so the first
 *      Back lands us right back here; we re-arm it and open the prompt instead
 *      of leaving. Armed only while dirty.
 *   3. Hard navigations the SPA can't intercept (refresh, tab close, typing a
 *      new URL) — `beforeunload`, where the browser only allows its OWN generic
 *      prompt. That's a deliberate backstop, not the custom modal.
 *
 * `leave()` performs the actual navigation once the user confirms; because it
 * uses the client router (a soft navigation) the beforeunload guard never fires
 * for it, even though `dirty` is still true at that moment.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // Read the latest dirty inside stable callbacks without re-creating them.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy assignment some browsers still require to trigger the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    // Buffer entry: the first Back pops this, keeping the real editor URL live.
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      // Re-arm the buffer so we stay put, then prompt.
      window.history.pushState(null, "", window.location.href);
      setPendingHref("/storefront");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [dirty]);

  /** Ask to leave for `href`. With no unsaved edits, go straight there. */
  const requestLeave = useCallback(
    (href: string) => {
      if (!dirtyRef.current) {
        router.push(href);
        return;
      }
      setPendingHref(href);
    },
    [router],
  );

  /** Dismiss the prompt and stay on the page. */
  const cancel = useCallback(() => setPendingHref(null), []);

  /** Leave for the pending destination, abandoning any unsaved edits. */
  const leave = useCallback(() => {
    const href = pendingHref ?? "/storefront";
    setPendingHref(null);
    router.push(href);
  }, [pendingHref, router]);

  return { promptOpen: pendingHref !== null, requestLeave, cancel, leave };
}
