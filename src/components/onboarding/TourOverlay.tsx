"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useSearch } from "@/components/search/SearchProvider";
import { Button } from "@/components/ui/button";
import {
  iconNudgeLeftClass,
  iconNudgeRightClass,
  overlaySurfaceClass,
} from "@/components/ui/control-styles";
import { EASE_STANDARD } from "@/components/ui/motion-tokens";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { useIsMacPlatform } from "@/lib/hooks/useIsMacPlatform";
import {
  anchorOf,
  resetAnchorCache,
  resolveTarget,
  type TourAnchor,
} from "@/lib/onboarding/tour-dom";
import {
  padBox,
  phoneCardEdge,
  placeCard,
  scrollDeltaFor,
  type Box,
} from "@/lib/onboarding/tour-geometry";
import { dashboardTour, type TourNext, type TourStore } from "@/lib/onboarding/tour-store";
import { tourStepsFor, type TourExtra, type TourStep } from "@/lib/onboarding/tour-steps";
import { embedSnippet } from "@/lib/storefront/embed-snippet";
import type { TeamRole } from "@/lib/team/permissions";
import { safeInternalPath } from "@/lib/utils/safe-path";
import { cn } from "@/lib/utils";

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
 * - navigating: not on the step's page yet. Pushed once; "Opening Products…"
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
 */

type TourPhase = "navigating" | "locating" | "anchored" | "fallback";

/** Where the rail pins open and the card goes beside its control (Tailwind md). */
const WIDE_QUERY = "(min-width: 48rem)";
/** Room around the control inside the hole. */
const HOLE_PAD = 6;
/** How long a page gets to render a control before it is believed missing. */
const GRACE_MS = 400;
/** Upper bound on waiting for a step's `waitFor` proof that the page rendered. */
const GIVE_UP_MS = 10_000;
/** The h-14 top bars: the phone header and the desktop top bar. */
const HEADER_PX = 56;
/** Keep a scrolled-to control clear of the sticky top bar, with a little air. */
const BAND_TOP_PX = HEADER_PX + 16;
const BAND_GAP_PX = 16;
/** A scroll that has not moved for this long has landed. Placement decisions
 *  that depend on where the control sits in the viewport wait for it. */
const SCROLL_STILL_MS = 150;
/** How long the page must hold still after the tour's first scroll before it is
 *  checked once more (a page still streaming in can grow under a scroll). */
const SCROLL_SETTLED_MS = 250;
/** A re-check only scrolls again if the control is further off than this. */
const RESCROLL_TOLERANCE_PX = 24;
/** The embed step shows what a snippet looks like before there is a real key. */
const SAMPLE_EMBED_KEY = "your-storefront-key";
/**
 * The dim, as the spotlight box's spread shadow. The same black wash as every
 * other scrim (overlayScrimClass is bg-black/40), spelled against the theme's
 * own colour variable. The spread only has to outreach the viewport from
 * wherever the box has scrolled to.
 */
const SPOTLIGHT_STYLE = {
  boxShadow: "0 0 0 9999px color-mix(in oklab, var(--color-black) 40%, transparent)",
} as const;

const SMALL_GHOST_CLASS = "px-2 py-1.5 text-xs";

function toBox(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Whether any edge moved by a whole pixel (sub-pixel noise is not a move). */
function moved(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.left - b.left) >= 1 ||
    Math.abs(a.top - b.top) >= 1 ||
    Math.abs(a.width - b.width) >= 1 ||
    Math.abs(a.height - b.height) >= 1
  );
}

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

function ActiveTour({
  role,
  store,
  steps: stepsOverride,
  pathname: pathnameOverride,
  navigate: navigateOverride,
  stepId,
  arrived,
  next,
}: {
  role: TeamRole | null;
  store: TourStore<string>;
  steps?: readonly TourStep<string>[];
  pathname?: string;
  navigate?: (path: string) => void;
  stepId: string;
  arrived: boolean;
  next: TourNext | null;
}) {
  const { end: endTour, goTo: goToStep, markArrived } = store;
  const t = useTranslations();
  const tOverlay = useTranslations("Onboarding.tourOverlay");
  const tActions = useTranslations("Common.actions");
  const router = useRouter();
  const routerPathname = usePathname();
  const pathname = pathnameOverride ?? routerPathname;
  const reducedMotion = useReducedMotion();
  const isMac = useIsMacPlatform();
  const searchOpen = useSearch()?.isOpen ?? false;
  const titleId = useId();
  const bodyId = useId();
  const counterId = useId();

  const steps = useMemo<readonly TourStep<string>[]>(
    () => stepsOverride ?? tourStepsFor(role),
    [stepsOverride, role],
  );
  const index = steps.findIndex((candidate) => candidate.id === stepId);
  const step: TourStep<string> | undefined = steps[index];

  const navigate = useCallback(
    (path: string) => {
      if (navigateOverride) navigateOverride(path);
      else router.push(path);
    },
    [navigateOverride, router],
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  /** What the spotlight was last written as, across steps, so a new step keeps
   *  the previous hole until its own control is found instead of flashing. */
  const spotWritten = useRef<{ anchor: TourAnchor; box: Box } | null>(null);
  /** The push this overlay made for a step, and the page it left from. */
  const pushedFor = useRef<{ stepId: string; from: string } | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  /** Which candidate the frame loop settled on for a step; null is fallback. */
  const [located, setLocated] = useState<{ stepId: string; index: number | null } | null>(
    null,
  );
  const locatedHere = located?.stepId === stepId ? located : null;
  const phase: TourPhase = !arrived
    ? "navigating"
    : !locatedHere
      ? "locating"
      : locatedHere.index === null
        ? "fallback"
        : "anchored";

  // A step this person no longer gets (their role changed, or a stored id from
  // an older tour) ends it rather than showing a stop about nothing.
  useEffect(() => {
    if (!step) endTour();
  }, [step, endTour]);

  // Getting to the step's page, and noticing when the person left it.
  useEffect(() => {
    if (!step) return;
    if (pathname === step.path) {
      pushedFor.current = null;
      if (!arrived) markArrived(step.id);
      return;
    }
    const pushed = pushedFor.current;
    if (pushed && pushed.stepId === step.id) {
      // Our push is in flight. A different page than the one we left, that is
      // not ours either, means somebody else navigated.
      if (pathname !== pushed.from) endTour();
      return;
    }
    if (arrived) {
      // We were on this step's page and are not any more: Back, forward, or a
      // link. They have left the tour.
      endTour();
      return;
    }
    pushedFor.current = { stepId: step.id, from: pathname };
    navigate(step.path);
  }, [step, pathname, arrived, navigate, endTour, markArrived]);

  // The palette would sit under the tour's layer; opening it means "I'll look
  // myself", so the tour gets out of the way.
  useEffect(() => {
    if (searchOpen) endTour();
  }, [searchOpen, endTour]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      endTour();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [endTour]);

  // Warm the next stop so Next feels immediate.
  const nextPath = steps[index + 1]?.path;
  useEffect(() => {
    if (!nextPath || navigateOverride || nextPath === pathname) return;
    router.prefetch(nextPath);
  }, [nextPath, navigateOverride, pathname, router]);

  // The frame loop: find the control, keep the spotlight and card on it.
  useEffect(() => {
    const spot = spotRef.current;

    /** Write the spotlight, only on a real change. Null dims everything. */
    const writeSpot = (anchor: TourAnchor, box: Box | null) => {
      if (!spot) return;
      const last = spotWritten.current;
      if (!box) {
        if (last === null && spot.dataset.empty === "true") return;
        spotWritten.current = null;
        spot.dataset.empty = "true";
        spot.dataset.anchor = "viewport";
        spot.style.left = spot.style.top = spot.style.width = spot.style.height = "";
        return;
      }
      if (last && last.anchor === anchor && !moved(last.box, box)) return;
      spotWritten.current = { anchor, box };
      spot.dataset.empty = "false";
      spot.dataset.anchor = anchor;
      spot.style.left = `${Math.round(box.left)}px`;
      spot.style.top = `${Math.round(box.top)}px`;
      spot.style.width = `${Math.round(box.width)}px`;
      spot.style.height = `${Math.round(box.height)}px`;
    };

    if (!step || !arrived) {
      writeSpot("viewport", null);
      return;
    }

    const startedAt = performance.now();
    let readyAt: number | null = step.waitFor ? null : startedAt;
    /** undefined: still deciding. null: fallback. A number: that candidate. */
    let decided: number | null | undefined;
    let scrolledFor: boolean | null = null;
    /** One more look is due once the tour's first scroll has landed. */
    let recheckPending = false;
    /** The tour scrolled: the card is placed again once the scroll lands. */
    let settlePending = false;
    let lastScrollX = window.scrollX;
    let lastScrollY = window.scrollY;
    let scrollStillSince = startedAt;
    /** The card element the last placement was for, and what it was placed
     *  against, so a card is placed once per real change and never per scroll. */
    let placedCard: HTMLElement | null = null;
    let placedAgainst: { anchor: TourAnchor; box: Box | null; size: string } | null = null;
    const wideQuery = window.matchMedia(WIDE_QUERY);
    let lastWide = wideQuery.matches;

    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const root = document.documentElement;
      const viewport = { width: root.clientWidth, height: root.clientHeight };
      const wide = wideQuery.matches;
      if (wide !== lastWide) {
        lastWide = wide;
        resetAnchorCache();
      }
      if (window.scrollX !== lastScrollX || window.scrollY !== lastScrollY) {
        lastScrollX = window.scrollX;
        lastScrollY = window.scrollY;
        scrollStillSince = now;
      }
      const still = now - scrollStillSince >= SCROLL_STILL_MS;
      const resolved = resolveTarget(step);

      if (readyAt === null && step.waitFor && document.querySelector(step.waitFor)) {
        readyAt = now;
      }
      let choice: number | null | undefined = decided;
      if (resolved) {
        choice = resolved.index;
      } else if (
        (readyAt !== null && now - readyAt >= GRACE_MS) ||
        now - startedAt >= GIVE_UP_MS
      ) {
        choice = null;
      }
      if (choice !== decided) {
        decided = choice;
        setLocated({ stepId: step.id, index: choice ?? null });
      }
      if (decided === undefined) return;

      const card = cardRef.current;
      const rect = resolved ? resolved.element.getBoundingClientRect() : null;
      const anchor: TourAnchor = resolved ? anchorOf(resolved.element) : "viewport";
      /** The control where it is on screen now, padded. */
      const onScreen = rect ? padBox(toBox(rect), HOLE_PAD, viewport) : null;

      // Bring the control into view once per surface (again after crossing the
      // breakpoint, where the layout and the card's position both change). On a
      // phone that waits for the card, whose height is the band's bottom. Once
      // that scroll has landed, look once more: a page still rendering can grow
      // under the first scroll and leave the control short of where it was sent.
      if (rect && step.scroll && (wide || card)) {
        const first = scrolledFor !== wide;
        const recheck = !first && recheckPending && now - scrollStillSince >= SCROLL_SETTLED_MS;
        if (first || recheck) {
          const delta = scrollDeltaFor(toBox(rect), viewport, {
            top: BAND_TOP_PX,
            bottom: (wide ? 0 : (card?.offsetHeight ?? 0)) + BAND_GAP_PX,
          });
          recheckPending = first;
          if (first) {
            scrolledFor = wide;
            scrollStillSince = now;
          }
          if (Math.abs(delta) > (first ? 0 : RESCROLL_TOLERANCE_PX)) {
            window.scrollBy({ top: delta, behavior: reducedMotionRef.current ? "auto" : "smooth" });
            settlePending = true;
          }
        }
      }

      // The spotlight: in page coordinates for a control that scrolls with the
      // page, so the browser moves the two together; unclipped, because a clip
      // that follows the viewport would have to be rewritten on every scroll.
      if (rect) {
        writeSpot(
          anchor,
          anchor === "document"
            ? {
                left: rect.left + window.scrollX - HOLE_PAD,
                top: rect.top + window.scrollY - HOLE_PAD,
                width: rect.width + HOLE_PAD * 2,
                height: rect.height + HOLE_PAD * 2,
              }
            : onScreen,
        );
      } else {
        writeSpot("viewport", null);
      }

      if (!card) return;
      if (card !== placedCard) {
        placedCard = card;
        placedAgainst = null;
      }

      if (wide) {
        // The card beside its control, in the control's own coordinate space,
        // so it scrolls with it too. Placed when something really changed, and
        // after the tour's own scroll lands (until then, a first placement
        // stays invisible rather than appearing and then jumping).
        if (settlePending && !still) return;
        const size = `${card.offsetWidth}x${card.offsetHeight}:${viewport.width}x${viewport.height}`;
        const pageBox =
          rect && anchor === "document"
            ? { left: rect.left + window.scrollX, top: rect.top + window.scrollY, width: rect.width, height: rect.height }
            : onScreen;
        const changed =
          !placedAgainst ||
          placedAgainst.anchor !== anchor ||
          placedAgainst.size !== size ||
          moved(placedAgainst.box, pageBox);
        if (!changed && !(settlePending && still)) return;
        settlePending = false;
        placedAgainst = { anchor, box: pageBox, size };
        const placement = onScreen
          ? placeCard(onScreen, { width: card.offsetWidth, height: card.offsetHeight }, viewport, {
              side: resolved?.target.side ?? step.side,
              gap: 12,
              edge: 16,
            })
          : {
              left: Math.round((viewport.width - card.offsetWidth) / 2),
              top: Math.round((viewport.height - card.offsetHeight) / 2),
            };
        const inPage = anchor === "document" && onScreen !== null;
        card.dataset.anchor = inPage ? "document" : "viewport";
        card.style.setProperty("--tour-x", `${Math.round(placement.left + (inPage ? window.scrollX : 0))}px`);
        card.style.setProperty("--tour-y", `${Math.round(placement.top + (inPage ? window.scrollY : 0))}px`);
        card.dataset.edge = "bottom";
        card.dataset.placed = "true";
      } else {
        // The phone card is fixed to an edge. Which edge depends on where the
        // control sits, so it is only decided once scrolling has stopped: a
        // decision made mid-scroll would flip back and forth.
        if (!still) return;
        const edge = onScreen ? phoneCardEdge(onScreen, card.offsetHeight, viewport, HEADER_PX) : "bottom";
        if (card.dataset.edge !== edge) card.dataset.edge = edge;
        if (card.dataset.placed !== "true") card.dataset.placed = "true";
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [step, arrived]);

  const focusTarget =
    phase === "navigating" ? "status" : phase === "locating" ? null : "card";
  useEffect(() => {
    if (focusTarget) cardRef.current?.focus({ preventScroll: true });
  }, [focusTarget, stepId]);
  useFocusTrap(cardRef, focusTarget !== null);

  if (!step) return null;

  const candidate =
    locatedHere && locatedHere.index !== null ? step.targets[locatedHere.index] : undefined;
  const body =
    phase === "anchored"
      ? (candidate?.body ?? step.body)
      : phase === "fallback"
        ? (step.fallbackBody ?? step.body)
        : step.body;
  const extra: TourExtra | undefined =
    phase === "anchored" ? candidate?.extra : phase === "fallback" ? step.fallbackExtra : undefined;
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const shortcut = isMac === null ? null : isMac ? "⌘K" : "Ctrl K";

  const forward = () => {
    const following = steps[index + 1];
    if (following) goToStep(following.id, { arrived: following.path === pathname });
  };
  const backward = () => {
    const previous = steps[index - 1];
    if (previous) goToStep(previous.id, { arrived: previous.path === pathname });
  };
  const finishWith = (offer: TourNext) => {
    const href = safeInternalPath(offer.href, "/dashboard");
    endTour();
    navigate(href);
  };

  return createPortal(
    // The layer. Deliberately unpositioned: its children are placed against the
    // PAGE (the spotlight and desktop card of a control that scrolls) or the
    // viewport (everything else), and a positioned wrapper would capture both.
    <div
      data-tour-step={step.id}
      data-tour-state={phase}
      data-tour-index={index + 1}
      data-tour-total={steps.length}
    >
      <div
        ref={spotRef}
        aria-hidden="true"
        data-tour-spotlight=""
        // Written by the frame loop; until then it is an empty box mid-screen,
        // whose shadow dims the whole page.
        data-anchor="viewport"
        data-empty="true"
        style={SPOTLIGHT_STYLE}
        className={cn(
          "pointer-events-none fixed left-1/2 top-1/2 z-[64] size-0 outline-2 outline-ring",
          "data-[anchor=document]:absolute data-[empty=true]:outline-0",
        )}
      />
      {/* Takes every click on the page while the tour runs. Also the ground
          truth for "the full fixed-position viewport width" in tests: Chromium
          computes a `position: fixed` element's containing block narrower than
          `window.innerWidth`/`documentElement.clientWidth` when this app's own
          scrollbar styling forces a classic (non-overlay) scrollbar, but
          neither DOM metric reflects that narrowing, so a width assertion has
          nothing reliable to compare the card against except a sibling that is
          `position: fixed` too. */}
      <div data-tour-catcher="" className="fixed inset-0 z-[65]" />

      {phase === "navigating" && (
        <motion.div
          key={`${step.id}-opening`}
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={tOverlay("dialogLabel")}
          tabIndex={-1}
          className={cn(
            overlaySurfaceClass,
            "fixed inset-x-4 bottom-4 z-[66] flex items-center justify-between gap-3 p-3 outline-none",
            "md:left-auto md:right-6 md:bottom-6 md:w-80",
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: reducedMotion ? 0 : 0.18, ease: EASE_STANDARD }}
        >
          <p role="status" className="font-inter text-sm text-muted-foreground">
            {tOverlay("openingPage", { page: step.page })}
          </p>
          <Button variant="ghost" className={SMALL_GHOST_CLASS} onClick={endTour}>
            {tOverlay("skipTour")}
          </Button>
        </motion.div>
      )}

      {(phase === "anchored" || phase === "fallback") && (
        <div
          key={step.id}
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={`${counterId} ${bodyId}`}
          tabIndex={-1}
          // Written by the frame loop: which edge the phone card sits on, which
          // coordinate space the desktop card is placed in, and whether it has
          // been placed yet (it waits, transparent, rather than appearing in the
          // wrong spot and jumping).
          data-edge="bottom"
          data-anchor="viewport"
          data-placed="false"
          className={cn(
            overlaySurfaceClass,
            "fixed inset-x-0 bottom-0 z-[66] pb-safe outline-none",
            "transition-opacity duration-base ease-standard motion-reduce:transition-none",
            "data-[edge=top]:bottom-auto data-[edge=top]:top-14",
            // Transparent, NOT invisible: a browser will not focus a
            // visibility:hidden element, and focus lands on the card the moment
            // it mounts, before it is placed.
            "data-[placed=false]:opacity-0",
            "md:right-auto md:bottom-auto md:left-(--tour-x) md:top-(--tour-y) md:w-80 md:pb-0",
            "md:data-[anchor=document]:absolute",
          )}
        >
          <motion.div
            className="p-4"
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: EASE_STANDARD }}
          >
            <p id={counterId} className="font-inter text-xs text-muted-foreground">
              {tOverlay("progress", { current: index + 1, total: steps.length })}
            </p>
            <h2 id={titleId} className="mt-1 text-base font-semibold text-foreground">
              {t(step.title)}
            </h2>
            <p id={bodyId} className="mt-1 font-inter text-sm text-muted-foreground">
              {t(body)}
            </p>
            {extra === "search-shortcut" && shortcut && (
              <p className="mt-2 font-inter text-sm text-muted-foreground">
                {tOverlay.rich("shortcut", {
                  shortcut,
                  kbd: (chunks) => (
                    <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-inter text-xs font-medium text-foreground">
                      {chunks}
                    </kbd>
                  ),
                })}
              </p>
            )}
            {extra === "embed-snippet" && (
              // Wraps rather than scrolls: a scroll region inside a dialog needs
              // its own keyboard access, and two lines do not earn one.
              <pre className="mt-3 whitespace-pre-wrap break-all border border-border bg-muted p-2 font-mono text-xs text-foreground">
                {embedSnippet(SAMPLE_EMBED_KEY)}
              </pre>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              {!isLast && (
                <Button variant="ghost" className={SMALL_GHOST_CLASS} onClick={endTour}>
                  {tOverlay("skipTour")}
                </Button>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {!isFirst && (
                  <Button variant="ghost" onClick={backward}>
                    <ArrowLeft className={cn("size-4", iconNudgeLeftClass)} aria-hidden />
                    {tActions("back")}
                  </Button>
                )}
                {!isLast ? (
                  <Button onClick={forward}>
                    {tOverlay("next")}
                    <ArrowRight className={cn("size-4", iconNudgeRightClass)} aria-hidden />
                  </Button>
                ) : next ? (
                  <>
                    <Button variant="ghost" onClick={endTour}>
                      {tActions("done")}
                    </Button>
                    <Button onClick={() => finishWith(next)}>
                      {next.label}
                      <ArrowRight className={cn("size-4", iconNudgeRightClass)} aria-hidden />
                    </Button>
                  </>
                ) : (
                  <Button onClick={endTour}>{tActions("done")}</Button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>,
    document.body,
  );
}
