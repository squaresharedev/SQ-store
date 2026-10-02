import { pageSubtitleClass, pageTitleClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

/**
 * The title block every dashboard page opens with: an `<h1>` and, usually, one
 * line saying what the page is for. Server-safe (no client boundary), so a
 * route and its `loading.tsx` can render the SAME header — which is the point:
 * the title must not move or resize when the data lands.
 *
 * `action` is the page's one header control (Orders' "Export CSV"), set to the
 * right of the title and under it on a narrow screen.
 *
 * `className` takes the spacing the page needs below it (`mb-6` on pages whose
 * shell has no `space-y`).
 */
export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const heading = (
    <div>
      <h1 className={pageTitleClass}>{title}</h1>
      {subtitle && <p className={pageSubtitleClass}>{subtitle}</p>}
    </div>
  );
  if (!action) return <div className={className}>{heading}</div>;
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      {heading}
      {/* Never wider than the column: an action with several parts (the plans
          page's pill and toggle) wraps inside it on a phone instead. */}
      <div className="max-w-full shrink-0">{action}</div>
    </div>
  );
}
