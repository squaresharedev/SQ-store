import { useLocale, useTranslations } from "next-intl";
import { changeRatio, formatChangeSize } from "@/components/analytics/compare";
import { badgeClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

/** The chip's moods: green for a change that is good for the store, red for
 *  one that is not, and grey for one that is not good news but not a loss. */
const TONE = {
  good: "bg-success/10 text-success",
  bad: "bg-danger-strong/10 text-danger-strong",
  calm: "bg-muted text-muted-foreground",
} as const;

/**
 * A figure's change on the period before, as a small chip: "▲ 40%". Nothing
 * at all when the period before had nothing to compare with (see
 * changeRatio). `downIsGood` is for a cost, where falling is the good news.
 * `calm` draws a bad change grey instead of red, for a page where red means
 * money lost (the analytics page keeps it for refunds), and a slower month is
 * not that.
 */
export function ChangeChip({
  current,
  previous,
  downIsGood = false,
  calm = false,
  className,
}: {
  current: number;
  previous: number;
  downIsGood?: boolean;
  calm?: boolean;
  className?: string;
}) {
  const t = useTranslations("Common.charts");
  const locale = useLocale();
  const ratio = changeRatio(current, previous);
  if (ratio === null) return null;
  const up = ratio >= 0;
  const size = formatChangeSize(ratio, locale);
  return (
    <span
      className={cn(
        badgeClass,
        "inline-flex shrink-0 items-center gap-1 px-1.5 font-semibold tabular-nums",
        TONE[up !== downIsGood ? "good" : calm ? "calm" : "bad"],
        className,
      )}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span aria-hidden>{size}</span>
      <span className="sr-only">{t(up ? "changeUp" : "changeDown", { percent: size })}</span>
    </span>
  );
}
