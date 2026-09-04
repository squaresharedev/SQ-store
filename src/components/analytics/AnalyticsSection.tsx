import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * One band of the analytics page: a source's heading, then its cards.
 *
 * The page is a stack of these rather than a flat list of cards because the
 * page now measures several DIFFERENT things. A seller scanning for "how many
 * people signed up" needs a place to stop scrolling, and a screen reader user
 * needs the heading level to say that revenue and bookings are siblings rather
 * than one long undifferentiated list of h2s.
 *
 * `data-analytics-section` is the anchor a machine reader uses to scope a
 * query to one source ("every metric under storefront_view"), which is why the
 * id is the source id verbatim. See docs/analytics-datapoints.md.
 */
export function AnalyticsSection({
  id,
  title,
  description,
  icon: Icon,
  state,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** live = real figures. awaiting = registered, nothing produces it yet. */
  state: "live" | "awaiting";
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`analytics-${id}`}
      data-analytics-section={id}
      data-analytics-state={state}
      className="space-y-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary text-secondary-foreground"
        >
          <Icon className="size-4" strokeWidth={2} />
        </span>
        {/* The description sits behind the "?" rather than under the
            heading. A page of five sections was five standing sentences
            explaining what each measures, read once and then permanently in
            the way of the numbers they introduce. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <h2
            id={`analytics-${id}`}
            className="text-lg font-semibold text-foreground"
          >
            {title}
          </h2>
          <InfoTip label={`What ${title} measures`}>{description}</InfoTip>
        </div>
      </div>
      {children}
    </section>
  );
}
