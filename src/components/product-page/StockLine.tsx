import { useTranslations } from "next-intl";
import type { StockBadge } from "@/types/stock";

/**
 * Availability, in the page's own voice. The badge is derived server-side and
 * only the low-stock arm carries a number, so this cannot say more than the
 * seller allowed.
 *
 * A physical product that does not track stock is IN STOCK while it is not
 * sold out: it can be bought, and the page's Availability switch then says
 * something for every product rather than nothing for most (it used to look
 * broken on any product without stock tracking). It also keeps a buyer from
 * telling a tracked product from an untracked one (see lib/stock/public.ts).
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
  } else if (stock?.state === "in_stock" || (stock === null && !isDigital)) {
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
    <p
      className="flex flex-wrap gap-x-3 text-sm"
      data-product-stock={soldOut ? "sold_out" : (stock?.state ?? (isDigital ? "untracked" : "in_stock"))}
    >
      {lines.map((line) => (
        <span key={line.text} className={line.emphasis ? "font-medium" : "opacity-70"}>
          {line.text}
        </span>
      ))}
    </p>
  );
}
