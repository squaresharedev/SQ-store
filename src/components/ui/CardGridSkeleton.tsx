import { useTranslations } from "next-intl";
import type { MessageKey } from "@/i18n/types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder for a grid of media cards while the server query runs. Used by
 * the products and storefront routes, which share the same card shape.
 *
 * The bars are `aria-hidden` with a single screen-reader line above them:
 * announcing a dozen empty boxes helps nobody, but silence during a load does
 * not either. Pulse honours reduced motion.
 */
export function CardGridSkeleton({
  cards = 8,
  loadingLabel,
  withImage = true,
  className,
}: {
  cards?: number;
  /** The whole sentence read out to assistive tech, e.g. "loading products". */
  loadingLabel: MessageKey;
  /** Reserve the card's image tile. Off for text-only cards. */
  withImage?: boolean;
  className?: string;
}) {
  const t = useTranslations();
  return (
    <div className={className}>
      <span className="sr-only">{t(loadingLabel)}</span>
      <ul
        aria-hidden="true"
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
        )}
      >
        {Array.from({ length: cards }, (_, index) => (
          <li
            key={index}
            className="flex flex-col rounded-none border border-border bg-card p-3 shadow-sm"
          >
            {withImage && (
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
            )}
            <div className="mt-3 flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <div className="mt-2.5 border-t border-border pt-2">
              <Skeleton className="h-3 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
