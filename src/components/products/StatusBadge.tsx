import type { ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";

const LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
};

/**
 * Status is a footnote on a product card, not a headline, so it gets a single
 * dot rather than a labelled pill: filled reads as live, hollow as draft. The
 * distinction is shape, not hue, so the chrome stays greyscale (styles.md §1).
 *
 * The label is still there for anyone who needs it — a tooltip on hover, and
 * text for screen readers — since a dot on its own says nothing out loud.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: ProductStatus;
  className?: string;
}) {
  const isActive = status === "active";
  return (
    // The dot rides on an opaque disc rather than straight on the photo. A
    // bare dot with only a halo dies on a dark image: the filled one sinks
    // into the picture and reads as the hollow one, which is the single
    // distinction this badge makes.
    <span
      title={LABELS[status]}
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-full bg-background/95 shadow-sm",
        className,
      )}
    >
      <span className="sr-only">{LABELS[status]}</span>
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          isActive ? "bg-foreground" : "border border-muted-foreground",
        )}
      />
    </span>
  );
}
