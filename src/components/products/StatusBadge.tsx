import type { ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";

/**
 * Active is the default, expected state, so it gets no chrome at all. Draft
 * is the exception worth flagging, and the badge must say what it is in plain
 * words. A hollow dot required prior knowledge (the seller had to learn what
 * a grey circle meant); the word "Draft" is self-describing on any background
 * photo, and it carries the consequence: a draft product's public page 404s
 * for buyers, so this is the one status that actually needs to be seen.
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
      className={cn(
        "inline-flex items-center rounded-sm bg-background/95 px-1.5 py-0.5 shadow-sm",
        "font-inter text-xs font-medium text-foreground",
        className,
      )}
    >
      Draft
    </span>
  );
}
