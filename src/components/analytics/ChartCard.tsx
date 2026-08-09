import type { ReactNode } from "react";
import { ChartNoAxesColumn } from "lucide-react";
import { helpTextClass } from "@/components/ui/control-styles";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

/**
 * Card chrome shared by every analytics chart — same surface as MetricTile.
 * When `empty` the body swaps to a quiet centered placeholder at chart
 * height, so the layout never jumps between empty and populated ranges.
 */
export function ChartCard({
  title,
  description,
  children,
  empty,
  emptyText = "No sales in this range",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <div className={cn(cardClass, "p-4")}>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && (
          <p className={helpTextClass}>
            {description}
          </p>
        )}
      </div>

      <div className="mt-4">
        {empty ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <ChartNoAxesColumn
              className="size-5 text-muted-foreground/60"
              aria-hidden="true"
            />
            <p className={helpTextClass}>
              {emptyText}
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
