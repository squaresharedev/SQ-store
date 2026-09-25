import { useTranslations } from "next-intl";
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
  const tStock = useTranslations("Common.stock");
  const t = useTranslations("ProductPage.stock");
  const lines: { text: string; emphasis: boolean }[] = [];
  if (soldOut) {
    lines.push({ text: tStock("soldOut"), emphasis: true });
  } else if (stock?.state === "low_stock") {
    lines.push({ text: tStock("lowStock", { remaining: stock.remaining }), emphasis: true });
  } else if (stock?.state === "in_stock") {
    lines.push({ text: tStock("inStock"), emphasis: false });
  }
  if (isDigital) {
    lines.push({
      text: digitalFormat
        ? t("digitalDownloadFormat", { format: digitalFormat })
        : t("digitalDownload"),
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
