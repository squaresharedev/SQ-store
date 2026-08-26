import type { ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";

const LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
};

/**
 * Active is the default, expected state, so it gets no chrome at all. Draft
 * is the exception worth flagging, so it alone gets a hollow dot on an
 * opaque disc (a bare dot dies on a dark photo).
 */
export function StatusBadge({
  status,
  className,
}: {
  status: ProductStatus;
  className?: string;
}) {
  if (status === "active") return null;

  return (
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
        className="size-2 rounded-full border border-muted-foreground"
      />
    </span>
  );
}
