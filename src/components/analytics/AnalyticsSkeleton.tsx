import { useTranslations } from "next-intl";
import { SIGNAL_SOURCES } from "@/lib/analytics/sources";
import { Skeleton } from "@/components/ui/skeleton";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import {
  heroChartHeightClass,
  heroFrameClass,
  leadLaneClass,
} from "@/components/analytics/chart-layout";

/**
 * Module-level loading skeleton mirroring the analytics layout: the range
 * controls, the sales section (the revenue hero, four tiles, two two-up rows
 * and the full-width status card) and then one band per registered signal
 * source.
 *
 * The signal bands are DERIVED from SIGNAL_SOURCES rather than hard-coded, for
 * the same reason the page itself is: a source added to the registry that then
 * appears out of nowhere after the skeleton clears is a layout jump, and
 * keeping a second hand-written count in sync is exactly the chore this whole
 * design is meant to remove.
 */
export function AnalyticsSkeleton() {
  const t = useTranslations("Analytics.loading");
  return (
    <div className="flex flex-col gap-10" aria-hidden="true">
      <span className="sr-only">{t("srLoading")}</span>

      {/* Range controls placeholder */}
      <Skeleton className="h-9 w-64" />

      <div className="flex flex-col gap-4">
        {/* Section heading */}
        <Skeleton className="h-6 w-40" />

        {/* The revenue hero: its label and figure, over the room its frame and
            chart will take. No card, because the hero has none. */}
        <div className={leadLaneClass}>
          <div className={heroFrameClass}>
            <div className={cn(heroChartHeightClass, "flex flex-col gap-3 px-6")}>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-10 w-48" />
            </div>
          </div>
        </div>

        {/* Tiles */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={cn(cardClass, "flex flex-col gap-3 p-4")}>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>

        {/* Chart pairs */}
        {Array.from({ length: 2 }, (_, row) => (
          <div key={row} className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className={cn(cardClass, "p-4")}>
                <Skeleton className="h-64" />
              </div>
            ))}
          </div>
        ))}

        {/* Full-width status card */}
        <div className={cn(cardClass, "p-4")}>
          <Skeleton className="h-64" />
        </div>
      </div>

      {/* Only the sources shown to EVERY seller. Which of the rest appear
          depends on the blocks that account has placed, which the skeleton
          cannot know: it renders before the read that answers it. Undershooting
          is the right way to be wrong, because a skeleton that reserves bands
          for sections that never arrive leaves the page collapsing upward as
          it loads. */}
      {SIGNAL_SOURCES.filter((source) => !source.awaiting).map((source) => {
        const tiles = source.carriesValue ? 3 : 2;
        const pairs = Math.max(source.panels.length - 1, 1);
        return (
          <div key={source.id} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-40" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: tiles }, (_, i) => (
                <div key={i} className={cn(cardClass, "flex flex-col gap-3 p-4")}>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-8 w-24" />
                </div>
              ))}
            </div>
            <div className={cn(cardClass, "p-4")}>
              <Skeleton className="h-64" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: pairs }, (_, i) => (
                <div key={i} className={cn(cardClass, "p-4")}>
                  <Skeleton className="h-64" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
