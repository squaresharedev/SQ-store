import type { StockBadge } from "@/types/stock";

export function StockBadge({
  badge,
  showInStock = false,
}: {
  badge: StockBadge | null;
  showInStock?: boolean;
}) {
  if (badge === null) return null;

  switch (badge.state) {
    case "in_stock":
      if (!showInStock) return null;
      return (
        <span className="rounded-full bg-secondary px-2 py-0.5 font-inter text-xs font-medium text-muted-foreground">
          In stock
        </span>
      );

    case "low_stock":
      return (
        <span className="rounded-full bg-secondary px-2 py-0.5 font-inter text-xs font-medium text-foreground">
          {"Only "}{badge.remaining}{" left"}
        </span>
      );

    case "sold_out":
      return (
        <span className="rounded-full bg-secondary px-2 py-0.5 font-inter text-xs font-medium text-destructive">
          Sold out
        </span>
      );
  }
}
