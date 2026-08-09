import { cn } from "@/lib/utils";
import { badgeClass } from "@/components/ui/surface-styles";
import type { StockBadge } from "@/types/stock";

export function StockBadge({
  badge,
  showInStock = false,
}: {
  badge: StockBadge | null;
  showInStock?: boolean;
}) {
  if (badge === null) return null;
  // "In stock" is the default state, so it is noise unless a surface asks for
  // it (a product page confirming availability, say).
  if (badge.state === "in_stock" && !showInStock) return null;

  const { label, tone } =
    badge.state === "in_stock"
      ? { label: "In stock", tone: "text-muted-foreground" }
      : badge.state === "low_stock"
        ? { label: `Only ${badge.remaining} left`, tone: "text-foreground" }
        : { label: "Sold out", tone: "text-destructive" };

  return <span className={cn(badgeClass, tone)}>{label}</span>;
}
