"use client";

import dynamic from "next/dynamic";
import { dashboardTour, type TourStore } from "@/lib/onboarding/tour-store";
import type { TourStep } from "@/lib/onboarding/tour-steps";
import type { TeamRole } from "@/lib/team/permissions";
import type { ActiveTourProps } from "./ActiveTour";

/**
 * THE GUIDED TOUR: one real control at a time, across the dashboard's pages.
 *
 * Each step dims the page around its control and shows a short card: beside
 * the control from md up, along the bottom on a phone. The tour walks the pages
 * itself (router.push), so a seller never has to find the next stop. Steps and
 * copy are data (lib/onboarding/tour-steps.ts); where the tour is lives in a
 * session store (tour-store.ts) because this component unmounts whenever a step
 * crosses into another route group's shell.
 *
 * HOW A STEP RUNS
 * - navigating: not on the step's page yet. Pushed once; "Opening Products..."
 *   after 300ms. If the page moves somewhere the tour did not send it (Back, a
 *   link), the person has left the tour, and it ends.
 * - locating: on the page, looking for the control. Given a short grace (and
 *   the step's `waitFor`, when the page streams its content in) before a
 *   missing control is believed missing.
 * - anchored: found and spotlit.
 * - fallback: not there (an empty store has no storefront card to point at).
 *   The card shows centred with its fallback copy, and upgrades to anchored if
 *   the control turns up after all.
 *
 * WHY THE SPOTLIGHT SCROLLS BY ITSELF. The dim is one transparent box over the
 * control whose spread shadow darkens everything else. For a control that
 * scrolls with the page, that box (and the desktop card beside it) is placed in
 * PAGE coordinates, so the browser scrolls them together with the control in the
 * same step. Placing it in viewport coordinates and chasing the scroll from a
 * frame loop always trails by a frame, because the page scrolls off the main
 * thread, and a fast scroll shows the lag as the hole jittering. Controls that
 * stay put while the page scrolls (the fixed sidebar, a stuck top bar) keep a
 * viewport-anchored spotlight instead (tour-dom.ts, anchorOf). The frame loop
 * still runs, but it only writes when layout really changed, never for a scroll.
 *
 * The page is not clickable while the tour runs: the tour owns navigation, and
 * a click that wandered off mid-step would strand it. Scrolling still works.
 * Esc, "Skip tour", opening search, or navigating away all end it.
 *
 * Accessibility: the card is a modal dialog, focus moves to it on each step (in
 * an effect, not a callback ref: a welcome dialog closing in the same commit
 * restores focus in its own cleanup, which would take it back), Tab stays
 * inside it, and every body is written to stand on its own for someone who
 * cannot see what is spotlit.
 *
 * SPLIT: the heavy implementation (frame loop, motion, portal) lives in
 * ActiveTour.tsx and is loaded dynamically. This file is always present but
 * tiny; the ~8 KB gz chunk only downloads when a tour is actually running.
 */

// ssr: false because ActiveTour uses createPortal, document, and window
// directly, and the tour state starts as "idle" on every SSR pass anyway.
const ActiveTour = dynamic<ActiveTourProps>(
  () => import("./ActiveTour").then((mod) => mod.ActiveTour),
  { ssr: false },
);

export function TourOverlay({
  store = dashboardTour,
  ...props
}: {
  role: TeamRole | null;
  /** Which tour this overlay runs. The dashboard's unless told otherwise; the
   *  storefront designer mounts its own with `editorTour` and its own steps. */
  store?: TourStore<string>;
  /** Injectable for the dev harness and tests; defaults to the role's steps. */
  steps?: readonly TourStep<string>[];
  pathname?: string;
  navigate?: (path: string) => void;
}) {
  const tour = store.useTour();
  if (tour.status !== "active") return null;
  return (
    <ActiveTour
      {...props}
      store={store}
      stepId={tour.stepId}
      arrived={tour.arrived}
      next={tour.next}
    />
  );
}
