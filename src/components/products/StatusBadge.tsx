import type { ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";

const LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
};

// Neutral, tokenised badge. Chrome stays greyscale (styles.md §1); the dot +
// text weight carry the distinction rather than a competing hue.
export function StatusBadge({
  status,
  className,
}: {
  status: ProductStatus;
  className?: string;
}) {
  const isActive = status === "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium",
        isActive ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          isActive ? "bg-foreground" : "bg-muted-foreground",
        )}
      />
      {LABELS[status]}
    </span>
  );
}
