import type { StockBadge } from "@/types/stock";

/**
 * Availability, in the page's own voice. The badge is derived server-side and
 * only the low-stock arm carries a number, so this cannot say more than the
 * seller allowed.
 */
export function StockLine({
  stock,
  soldOut,
  isDigital,
  digitalFormat,
}: {
  stock: StockBadge | null;
  soldOut: boolean;
  isDigital: boolean;
  digitalFormat: string | null;
}) {
  const lines: { text: string; emphasis: boolean }[] = [];
  if (soldOut) {
    lines.push({ text: "Sold out", emphasis: true });
  } else if (stock?.state === "low_stock") {
    lines.push({ text: `Only ${stock.remaining} left`, emphasis: true });
  } else if (stock?.state === "in_stock") {
    lines.push({ text: "In stock", emphasis: false });
  }
  if (isDigital) {
    lines.push({
      text: digitalFormat ? `Digital download (${digitalFormat})` : "Digital download",
      emphasis: false,
    });
  }
  if (lines.length === 0) return null;

  return (
    <p className="flex flex-wrap gap-x-3 text-sm" data-product-stock={soldOut ? "sold_out" : stock?.state ?? "untracked"}>
      {lines.map((line) => (
        <span key={line.text} className={line.emphasis ? "font-medium" : "opacity-70"}>
          {line.text}
        </span>
      ))}
    </p>
  );
}
