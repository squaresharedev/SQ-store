"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, CheckCircle2, ChevronDown, ExternalLink } from "lucide-react";
import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  iconNudgeRightClass,
  infoTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { useStoredFlag } from "@/lib/hooks/useStoredFlag";
import type { SetupChecklistData, SetupStep, SetupStepId } from "@/lib/onboarding/steps";
import { cn } from "@/lib/utils";

/** Per-device: a seller who knows the way can fold the steps away. */
export const SETUP_COLLAPSED_KEY = "sq.dashboard.setup-collapsed";

/** Same treatment as NeedsAttention's row links, so the two modules' actions
 *  read as one family on the same page. */
const ROW_LINK_CLASS =
  "group/btn inline-flex items-center gap-1 font-inter text-xs font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none";

const HEADER_BUTTON_CLASS = "px-2 py-1.5 text-xs";

/** Where each step's point sits across the trail, as a share of its width. The
 *  points alternate sides, so the trail winds from one to the next. */
const TRAIL_X = [28, 72] as const;
const trailX = (index: number) => TRAIL_X[index % 2];

/** A point's centre, down from the top of its row: the divider, the rows' py-3
 *  and half the label's 1.25rem line, so it sits level with the label and the
 *  row's box. The SAME in every row (the first carries a transparent divider),
 *  or a leg would end off its next point. */
const POINT_TOP_CLASS = "top-[calc(1.375rem+1px)]";

/** The stretch of trail from one point down to the next: walked (both ends
 *  done), the NEXT one to walk (it leads to the first unfinished step, and its
 *  dashes march towards it), or still ahead. */
type LegState = "done" | "next" | "todo";

const LEG_TONE: Record<LegState, string> = {
  done: "text-success",
  next: "text-foreground",
  todo: "text-muted-foreground/45",
};

type PointState = "done" | "current" | "todo";

const POINT_CLASS: Record<PointState, string> = {
  done: "bg-success text-background",
  current: "border-2 border-foreground bg-background text-foreground ring-4 ring-foreground/10",
  todo: "border border-muted-foreground/40 bg-background text-muted-foreground",
};

/** A fresh step's moment, in ms (the keyframes are in globals.css, "setup
 *  checklist: a step seen done for the first time"). It starts a beat after
 *  the card is in view, the leg into the point draws first, then the point
 *  pops; several fresh steps go one after another, in order. */
const FRESH_START_MS = 300;
const LEG_DRAW_MS = 500; // = .setup-leg-draw's duration
const FRESH_STEP_GAP_MS = 420;

/** Long enough for four fresh steps to finish playing, after which the caller
 *  can stop marking them fresh (so folding and unfolding the card does not
 *  replay them). */
export const SETUP_ANIMATION_SETTLE_MS = 5000;

/** When each fresh step's parts play: `legAt` for the leg drawn INTO its point
 *  (only when the point before it is done, or the leg is not green), `pointAt`
 *  for the point, flag and row. */
type FreshTiming = { legAt: number | null; pointAt: number };

function scheduleFresh(
  steps: readonly SetupStep[],
  fresh: readonly SetupStepId[],
): (FreshTiming | undefined)[] {
  let cursor = FRESH_START_MS;
  return steps.map((step, index) => {
    if (!fresh.includes(step.id)) return undefined;
    const draws = index > 0 && steps[index - 1].done;
    const timing = {
      legAt: draws ? cursor : null,
      pointAt: cursor + (draws ? LEG_DRAW_MS - 80 : 0),
    };
    cursor = timing.pointAt + FRESH_STEP_GAP_MS;
    return timing;
  });
}

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * "GET SET UP": Overview's checklist from a new account to a live product page.
 *
 * Every step is derived from real data on each render (lib/onboarding/
 * steps.ts), so it can never claim something is done that is not. The steps are
 * a list with a trail beside it: a dashed path that winds through one point per
 * step, level with that step's row, each point turning green with a check once
 * its step is done. The trail is decoration (the list says the same in words).
 * Laid out in CSS alone, so it renders on the server and never waits to measure
 * anything: each row draws the leg from its own point down to the next one's,
 * which is exactly one row further down whatever the row's height. It cannot be
 * dismissed while unfinished, only folded away on this device: until the last
 * step is done the seller cannot sell, and a checklist that can be thrown away
 * is how the publish gate goes back to being a surprise.
 *
 * Once complete it turns into the payoff (the page's link, to copy), shown
 * ONCE: the first time it renders it is recorded on the profile
 * (setup_celebrated_at, via `onCelebrated`), so it is gone from the next visit
 * on every device. "Hide" puts it away sooner, for this visit.
 *
 * The guided tour is replayed from Settings > Account, not from here.
 *
 * Publishes itself for agents and specs: data-setup-* on the card and on each
 * row, from the same object the rows render.
 */
export function SetupChecklist({
  setup,
  livePageUrl,
  celebrate,
  onCelebrated,
  freshSteps = [],
  paused = false,
  onStepsSeen,
}: {
  setup: SetupChecklistData;
  /** The live product page as an absolute URL, when there is one. */
  livePageUrl: string | null;
  /** The finished card has not been shown to this person yet (latched by the
   *  caller for the visit). */
  celebrate: boolean;
  /** The finished card is on screen: record that it has been shown. */
  onCelebrated: () => void;
  /** Steps done since this device last looked: each plays its "done" moment
   *  (the leg draws in, the point turns green, the flag goes up, the box ticks),
   *  one after another, starting from how the step looked before. */
  freshSteps?: readonly SetupStepId[];
  /** Something covers the card (the welcome dialog): hold the animation. */
  paused?: boolean;
  /** The steps have been on screen, unfolded and uncovered: what they show now
   *  counts as seen. Called again whenever that changes while on screen. */
  onStepsSeen?: () => void;
}) {
  const t = useTranslations();
  const listId = useId();
  const [collapsed, setCollapsed] = useStoredFlag(SETUP_COLLAPSED_KEY);
  const [hidden, setHidden] = useState(false);
  const showingCelebration = setup.complete && celebrate;
  /** The first unfinished step: where the trail has got to. */
  const current = setup.steps.findIndex((step) => !step.done);
  const schedule = scheduleFresh(setup.steps, freshSteps);
  /** Where the trail had got to BEFORE the fresh steps: that point wore the
   *  "current" look, so that is the look it animates out of. */
  const before = setup.steps.findIndex(
    (step) => !step.done || freshSteps.includes(step.id),
  );

  // The animation waits (paused on its first frame, the "before" pose) until
  // the card is actually in view: Overview can open scrolled, and a moment
  // played off screen is a moment missed.
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [setup.complete]);
  const playing = inView && !collapsed && !paused && !setup.complete;

  useEffect(() => {
    if (playing) onStepsSeen?.();
  }, [playing, onStepsSeen]);

  useEffect(() => {
    if (showingCelebration) onCelebrated();
  }, [showingCelebration, onCelebrated]);

  if (setup.complete && (!celebrate || hidden)) return null;

  const headerAction = setup.complete ? undefined : (
    <Button
      variant="ghost"
      className={HEADER_BUTTON_CLASS}
      aria-expanded={!collapsed}
      aria-controls={listId}
      onClick={() => setCollapsed(!collapsed)}
    >
      {collapsed ? t("Onboarding.checklist.showSteps") : t("Onboarding.checklist.hideSteps")}
      <ChevronDown
        className={cn(
          "size-3.5 transition-transform duration-base ease-standard motion-reduce:transition-none",
          collapsed && "-rotate-90",
        )}
        strokeWidth={2}
        aria-hidden
      />
    </Button>
  );

  return (
    // ModuleCard takes no data-* (closed props), so the datapoints ride a
    // wrapper rather than silently going missing.
    <div
      ref={rootRef}
      data-setup-checklist=""
      data-setup-playing={playing ? "" : undefined}
      data-setup-fresh={freshSteps.length > 0 ? freshSteps.join(" ") : undefined}
      data-setup-done={setup.doneCount}
      data-setup-total={setup.total}
      data-setup-complete={setup.complete ? "true" : "false"}
      data-setup-live-path={setup.livePage?.path}
    >
      <ModuleCard
        title={setup.complete ? t("Onboarding.checklist.titleDone") : t("Onboarding.checklist.title")}
        action={headerAction}
      >
        {setup.complete ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-inter text-sm text-muted-foreground">
              <CheckCircle2
                className="size-4 shrink-0 text-success"
                strokeWidth={2}
                aria-hidden="true"
              />
              {t("Onboarding.checklist.liveHint")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {livePageUrl && (
                <>
                  <CopyButton
                    value={livePageUrl}
                    messages={{
                      copy: "Onboarding.checklist.copyLink.copy",
                      copied: "Onboarding.checklist.copyLink.copied",
                      failed: "Onboarding.checklist.copyLink.failed",
                    }}
                    variant="labelled"
                  />
                  <a
                    href={livePageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(secondaryButtonClass, "px-3 py-1.5 text-xs")}
                  >
                    {t("Onboarding.checklist.openPage")}
                    <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only">{t("Onboarding.checklist.opensInNewTab")}</span>
                  </a>
                </>
              )}
              <Button
                variant="ghost"
                className={cn(HEADER_BUTTON_CLASS, "ml-auto")}
                onClick={() => setHidden(true)}
              >
                {t("Onboarding.checklist.hide")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className={cn(infoTextClass, "mb-3")}>
              {t("Onboarding.checklist.progress", {
                done: setup.doneCount,
                total: setup.total,
              })}
            </p>
            {/* The trail's width follows the CARD, not the viewport: the same
                card sits full width on Overview and half width in the gallery. */}
            <div id={listId} hidden={collapsed} className="@container">
              <div className="relative [--trail:5.5rem] @lg:[--trail:7rem] @2xl:[--trail:11rem] @4xl:[--trail:14rem]">
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-(--trail) rounded-md bg-muted/60"
                />
                {/* pt-5: headroom in the panel for the first point's flag. */}
                <ol className="relative pt-5">
                  {setup.steps.map((step, index) => (
                    <li
                      key={step.id}
                      data-setup-step={step.id}
                      data-setup-state={step.done ? "done" : "todo"}
                      className="group/row grid grid-cols-[var(--trail)_minmax(0,1fr)] gap-x-4"
                    >
                      <TrailPoint
                        steps={setup.steps}
                        index={index}
                        current={current}
                        before={before}
                        fresh={schedule[index]}
                        nextFresh={schedule[index + 1]}
                      />
                      <div
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t py-3",
                          index > 0 ? "border-border" : "border-transparent",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <StepBox done={step.done} freshAt={schedule[index]?.pointAt} />
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "text-sm font-medium",
                                step.done ? "text-muted-foreground" : "text-foreground",
                                schedule[index] && "setup-anim setup-label-settle",
                              )}
                              style={
                                schedule[index] ? delay(schedule[index].pointAt + 150) : undefined
                              }
                            >
                              {t(step.label.key, step.label.values)}
                              <span className="sr-only">
                                {step.done
                                  ? t("Onboarding.checklist.stepDone")
                                  : t("Onboarding.checklist.stepToDo")}
                              </span>
                            </p>
                            <p className={infoTextClass}>
                              {t(step.detail.key, step.detail.values)}
                            </p>
                          </div>
                        </div>
                        {!step.done && step.action && (
                          <Link href={step.action.href} className={ROW_LINK_CLASS}>
                            {t(step.action.label.key, step.action.label.values)}
                            <ArrowRight
                              className={cn("size-3", iconNudgeRightClass)}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        )}
      </ModuleCard>
    </div>
  );
}

/**
 * One step's point on the trail, and the leg from it down to the next point.
 *
 * The leg is an S-curve in a 100x100 box stretched over the row
 * (preserveAspectRatio none): it starts at this point's centre and ends one row
 * height further down, which is where the next row puts ITS point, so the legs
 * meet under the points at any row height. The stroke is non-scaling, so the
 * stretch never thickens the line or its dashes.
 *
 * A FRESH step (done since this device last looked) is drawn twice over: its
 * old pose underneath (the pale leg in, the numbered point, the old flag) and
 * the done pose on top, which the animation brings in and the old one gives way
 * to. Under reduced motion the old pose is not drawn at all.
 */
function TrailPoint({
  steps,
  index,
  current,
  before,
  fresh,
  nextFresh,
}: {
  steps: SetupStep[];
  index: number;
  current: number;
  /** The step that was current before the fresh ones were done. */
  before: number;
  /** This step's moment, when it is fresh. */
  fresh: FreshTiming | undefined;
  /** The NEXT step's moment: the leg into it is drawn from this row. */
  nextFresh: FreshTiming | undefined;
}) {
  const step = steps[index];
  const x = trailX(index);
  const point: PointState = step.done ? "done" : index === current ? "current" : "todo";
  const oldPoint: PointState = index === before ? "current" : "todo";
  const hasLeg = index < steps.length - 1;
  const leg: LegState | null = !hasLeg
    ? null
    : index + 1 === current
      ? "next"
      : step.done && steps[index + 1].done
        ? "done"
        : "todo";
  const legDrawsAt = leg === "done" ? (nextFresh?.legAt ?? null) : null;

  return (
    <div aria-hidden className="relative">
      {leg && legDrawsAt !== null && (
        <TrailLeg from={x} to={trailX(index + 1)} state="todo" className="motion-reduce:hidden" />
      )}
      {leg && (
        <TrailLeg
          from={x}
          to={trailX(index + 1)}
          state={leg}
          className={legDrawsAt !== null ? "setup-anim setup-leg-draw" : undefined}
          style={legDrawsAt !== null ? delay(legDrawsAt) : undefined}
        />
      )}
      {fresh && (
        <TrailFlag
          point={oldPoint}
          side={index % 2 === 0 ? "left" : "right"}
          x={x}
          className="motion-reduce:hidden"
          pennantClassName="setup-anim setup-fade-out"
          pennantStyle={delay(fresh.pointAt + 120)}
        />
      )}
      <TrailFlag
        point={point}
        side={index % 2 === 0 ? "left" : "right"}
        x={x}
        pennantClassName={fresh ? "setup-anim setup-flag-raise" : undefined}
        pennantStyle={fresh ? delay(fresh.pointAt + 120) : undefined}
      />
      {fresh && (
        <>
          <span
            className={cn(
              "setup-anim setup-fade-out absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-inter text-xs font-semibold motion-reduce:hidden",
              POINT_TOP_CLASS,
              POINT_CLASS[oldPoint],
            )}
            style={{ left: `${x}%`, ...delay(fresh.pointAt) }}
          >
            {index + 1}
          </span>
          <span
            className={cn(
              "setup-anim setup-point-burst absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-success motion-reduce:hidden",
              POINT_TOP_CLASS,
            )}
            style={{ left: `${x}%`, ...delay(fresh.pointAt + 80) }}
          />
        </>
      )}
      <span
        data-setup-point={point}
        className={cn(
          "absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-inter text-xs font-semibold transition duration-base ease-standard group-hover/row:scale-110 motion-reduce:transition-none",
          POINT_TOP_CLASS,
          POINT_CLASS[point],
          fresh && "setup-anim setup-point-pop",
        )}
        style={{ left: `${x}%`, ...(fresh ? delay(fresh.pointAt) : {}) }}
      >
        {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
      </span>
    </div>
  );
}

/** One leg of the trail, from a point at `from`% across to the next at `to`%. */
function TrailLeg({
  from,
  to,
  state,
  className,
  style,
}: {
  from: number;
  to: number;
  state: LegState;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      data-setup-leg={state}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn(
        "absolute inset-x-0 h-full w-full overflow-visible transition-colors duration-slow ease-standard motion-reduce:transition-none",
        POINT_TOP_CLASS,
        LEG_TONE[state],
        className,
      )}
      style={style}
    >
      <path
        d={`M ${from} 0 C ${from} 50, ${to} 50, ${to} 100`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="5 6"
        vectorEffect="non-scaling-stroke"
        className={cn(state === "next" && "setup-trail-march")}
      />
    </svg>
  );
}

/**
 * The pennant planted beside a point: green once the step is done, ink (and
 * waving) on the step to take next, pale while it is still ahead.
 *
 * Drawn in the point's own coordinates, (0, 0) at its centre, and planted on the
 * OUTER side: the leg arriving from the point above comes in from the inner
 * side, so a flag there would stand in the path. Painted before the point, so
 * the foot of the pole tucks under it.
 */
function TrailFlag({
  point,
  side,
  x,
  className,
  pennantClassName,
  pennantStyle,
}: {
  point: PointState;
  side: "left" | "right";
  x: number;
  className?: string;
  pennantClassName?: string;
  pennantStyle?: CSSProperties;
}) {
  return (
    <svg
      data-setup-flag={point}
      viewBox="-24 -36 48 36"
      className={cn(
        "absolute h-9 w-12 origin-bottom -translate-x-1/2 -translate-y-full overflow-visible transition duration-base ease-standard group-hover/row:scale-110 motion-reduce:transition-none",
        POINT_TOP_CLASS,
        className,
      )}
      style={{ left: `${x}%` }}
    >
      <g transform={side === "left" ? "scale(-1 1)" : undefined}>
        <line
          x1={6}
          y1={-5}
          x2={6}
          y2={-34}
          strokeWidth={1.75}
          strokeLinecap="round"
          className={point === "todo" ? "stroke-muted-foreground/50" : "stroke-foreground"}
        />
        <path
          d="M 6.875 -34 H 19 L 15 -28 L 19 -22 H 6.875 Z"
          strokeLinejoin="round"
          className={cn(
            "transition-colors duration-slow ease-standard motion-reduce:transition-none",
            FLAG_CLASS[point],
            pennantClassName,
          )}
          style={pennantStyle}
        />
      </g>
    </svg>
  );
}

const FLAG_CLASS: Record<PointState, string> = {
  done: "fill-success",
  current: "setup-flag-wave fill-foreground",
  todo: "fill-muted-foreground/25",
};

/** The row's own mark: an empty circle, or a checked one once the step is done.
 *  A fresh step's circle fills and its tick pops at `freshAt`. */
function StepBox({ done, freshAt }: { done: boolean; freshAt?: number }) {
  const fresh = freshAt !== undefined;
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-base ease-standard motion-reduce:transition-none",
        done
          ? "border-muted-foreground bg-muted-foreground text-background"
          : "border-muted-foreground/60 bg-background",
        fresh && "setup-anim setup-box-fill",
      )}
      style={fresh ? delay(freshAt) : undefined}
    >
      {done && (
        <Check
          className={cn("size-3", fresh && "setup-anim setup-check-pop")}
          style={fresh ? delay(freshAt + 100) : undefined}
          strokeWidth={3}
        />
      )}
    </span>
  );
}
