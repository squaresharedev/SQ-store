"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
} from "lucide-react";
import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  iconNudgeRightClass,
  infoTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { useStoredFlag } from "@/lib/hooks/useStoredFlag";
import type { SetupChecklistData } from "@/lib/onboarding/steps";
import { cn } from "@/lib/utils";

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
 * steps.ts), so it can never claim something is done that is not. It cannot be
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
}: {
  setup: SetupChecklistData;
  /** The live product page as an absolute URL, when there is one. */
  livePageUrl: string | null;
  /** The finished card has not been shown to this person yet (latched by the
   *  caller for the visit). */
  celebrate: boolean;
  /** The finished card is on screen: record that it has been shown. */
  onCelebrated: () => void;
}) {
  const listId = useId();
  const [collapsed, setCollapsed] = useStoredFlag(SETUP_COLLAPSED_KEY);
  const [hidden, setHidden] = useState(false);
  const showingCelebration = setup.complete && celebrate;

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
      {collapsed ? "Show steps" : "Hide steps"}
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
      data-setup-checklist=""
      data-setup-done={setup.doneCount}
      data-setup-total={setup.total}
      data-setup-complete={setup.complete ? "true" : "false"}
      data-setup-live-path={setup.livePage?.path}
    >
      <ModuleCard
        title={setup.complete ? "You're set up" : "Get set up"}
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
              Your first product page is live. Share the link anywhere.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {livePageUrl && (
                <>
                  <CopyButton
                    value={livePageUrl}
                    label="product page link"
                    variant="labelled"
                  />
                  <a
                    href={livePageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(secondaryButtonClass, "px-3 py-1.5 text-xs")}
                  >
                    Open page
                    <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </>
              )}
              <Button
                variant="ghost"
                className={cn(HEADER_BUTTON_CLASS, "ml-auto")}
                onClick={() => setHidden(true)}
              >
                Hide
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 space-y-1.5">
              <ProgressBar
                value={setup.doneCount / setup.total}
                label="Setup progress"
              />
              <p className={infoTextClass}>
                {setup.doneCount} of {setup.total} done
              </p>
            </div>
            <ol id={listId} hidden={collapsed} className="divide-y divide-border">
              {setup.steps.map((step) => (
                <li
                  key={step.id}
                  data-setup-step={step.id}
                  data-setup-state={step.done ? "done" : "todo"}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {step.done ? (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-success"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          step.done ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {step.label}
                        <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                      </p>
                      <p className={infoTextClass}>{step.detail}</p>
                    </div>
                  </div>
                  {!step.done && step.action && (
                    <Link href={step.action.href} className={ROW_LINK_CLASS}>
                      {step.action.label}
                      <ArrowRight
                        className={cn("size-3", iconNudgeRightClass)}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </ModuleCard>
    </div>
  );
}
