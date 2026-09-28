"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, ChevronDown, ExternalLink } from "lucide-react";
import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  iconNudgeRightClass,
  infoTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { useStoredFlag } from "@/lib/hooks/useStoredFlag";
import type { SetupChecklistData, SetupStepId } from "@/lib/onboarding/steps";
import { cn } from "@/lib/utils";
import {
  delay,
  MAP_ROW_PAD_CLASS,
  MAP_WIDTH_CLASS,
  MapCell,
  scheduleMoments,
} from "./SetupMap";

/** Per-device: a seller who knows the way can fold the steps away. */
export const SETUP_COLLAPSED_KEY = "sq.dashboard.setup-collapsed";

/** Same treatment as NeedsAttention's row links, so the two modules' actions
 *  read as one family on the same page. */
const ROW_LINK_CLASS =
  "group/btn inline-flex items-center gap-1 font-inter text-xs font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none";

const HEADER_BUTTON_CLASS = "px-2 py-1.5 text-xs";

/**
 * "GET SET UP": Overview's checklist from a new account to a live product page.
 *
 * Every step is derived from real data on each render (lib/onboarding/
 * steps.ts), so it can never claim something is done that is not. The steps are
 * a list with a transit line beside it (SetupMap.tsx), a station level with each
 * step's row. It cannot be dismissed while unfinished, only folded away on this device: until the last
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
   *  (the line fills, the station pops green, the row's text greys), one after
   *  another, starting from how the step looked before. */
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
  const moments = scheduleMoments(setup.steps, freshSteps);

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
            <div id={listId} hidden={collapsed} className="@container">
              <div className={cn("relative", MAP_WIDTH_CLASS)}>
                <ol className="relative">
                  {setup.steps.map((step, index) => {
                    // The row plays along when its step is the fresh one (not
                    // when it has merely become current).
                    const freshAt =
                      step.done && moments[index] ? moments[index].at : undefined;
                    return (
                    <li
                      key={step.id}
                      data-setup-step={step.id}
                      data-setup-state={step.done ? "done" : "todo"}
                      className="group/row grid grid-cols-[var(--map)_minmax(0,1fr)] gap-x-(--map-gap)"
                    >
                      <MapCell
                        steps={setup.steps}
                        index={index}
                        moments={moments}
                      />
                      <div
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t",
                          MAP_ROW_PAD_CLASS,
                          index > 0 ? "border-border" : "border-transparent",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "text-sm font-medium",
                                step.done ? "text-muted-foreground" : "text-foreground",
                                freshAt !== undefined && "setup-anim setup-label-settle",
                              )}
                              style={freshAt !== undefined ? delay(freshAt + 150) : undefined}
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
                    );
                  })}
                </ol>
              </div>
            </div>
          </>
        )}
      </ModuleCard>
    </div>
  );
}
