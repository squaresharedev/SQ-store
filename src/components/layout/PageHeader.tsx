import { pageSubtitleClass, pageTitleClass } from "@/components/ui/surface-styles";

/**
 * The title block every dashboard page opens with: an `<h1>` and, usually, one
 * line saying what the page is for. Server-safe (no client boundary), so a
 * route and its `loading.tsx` can render the SAME header — which is the point:
 * the title must not move or resize when the data lands.
 *
 * `className` takes the spacing the page needs below it (`mb-6` on pages whose
 * shell has no `space-y`).
 */
export function PageHeader({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h1 className={pageTitleClass}>{title}</h1>
      {subtitle && <p className={pageSubtitleClass}>{subtitle}</p>}
    </div>
  );
}
