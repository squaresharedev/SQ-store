"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { TourOverlay } from "@/components/onboarding/TourOverlay";
import { markEditorTourSeen } from "@/lib/onboarding/actions";
import { EDITOR_TOUR_STEPS } from "@/lib/onboarding/editor-tour-steps";
import { editorTour } from "@/lib/onboarding/tour-store";

/**
 * Started once per tab at most, whatever the server said. Back and forward
 * reuse a cached page whose `autoStart` still reads true from before the flag
 * was written, and a tour that restarted on every return would be a toll.
 */
let startedInThisTab = false;
/** How many designers are mounted, so a StrictMode remount is not a leave. */
let mountedEditors = 0;

/**
 * The storefront designer's short tour (lib/onboarding/editor-tour-steps.ts),
 * mounted by the designer in sample mode.
 *
 * Starts by itself when `autoStart` (the person's `editor_tour_seen_at` is still
 * null) and records the start straight away, so it is a first-visit thing on
 * every device. Recording on START rather than on finish, like the welcome flow:
 * a tour that waited for "Done" would come back for everyone who pressed Esc.
 *
 * Every stop is on the page this designer is showing, so the steps take their
 * path from it and the overlay never navigates. Leaving the designer is what
 * ends the tour: this unmounts, and a tour left active would otherwise resume
 * mid-way on the next visit. A refresh unmounts nothing, so it still resumes.
 *
 * Must render inside the designer's SearchProvider, so opening search ends the
 * tour here the same way it does on the dashboard.
 */
export function EditorTour({ autoStart }: { autoStart: boolean }) {
  const pathname = usePathname();
  const steps = useMemo(
    () => EDITOR_TOUR_STEPS.map((step) => ({ ...step, path: pathname as `/${string}` })),
    [pathname],
  );

  useEffect(() => {
    if (!autoStart || startedInThisTab) return;
    startedInThisTab = true;
    editorTour.start();
    // Best effort by contract: a failed write means one more tour next visit.
    markEditorTourSeen().catch(() => {});
  }, [autoStart]);

  useEffect(() => {
    mountedEditors += 1;
    return () => {
      mountedEditors -= 1;
      // Checked a tick later: StrictMode unmounts and remounts straight away in
      // development, and that is not the seller leaving.
      setTimeout(() => {
        if (mountedEditors === 0) editorTour.end();
      }, 0);
    };
  }, []);

  return <TourOverlay role={null} store={editorTour} steps={steps} />;
}

/** Replay from the sample's own "Take the tour" button. */
export function startEditorTour(): void {
  editorTour.start();
}

/** Tests only. */
export function __resetEditorTourLatchForTests(): void {
  startedInThisTab = false;
  mountedEditors = 0;
}
