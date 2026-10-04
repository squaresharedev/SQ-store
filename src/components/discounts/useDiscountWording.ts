import { useLocale, useTranslations } from "next-intl";
import { formatCents } from "@/lib/format/money";
import { formatOrderDateTime } from "@/lib/format/date";
import type { Locale } from "@/i18n/locales";
import type {
  DiscountKind,
  DiscountScope,
  DiscountStatus,
  DiscountValue,
  MoneyTotal,
} from "@/types/discount";

/**
 * How a discount is put into words, in one place: the list's rows and the
 * form's live summary both describe a discount through this, so "20% off each
 * item" reads the same wherever a seller meets it.
 */
export function useDiscountWording() {
  const t = useTranslations("Discounts.terms");
  const locale = useLocale() as Locale;

  return {
    /** "20% off each item" (a sale) or "€5.00 off the order" (a code). */
    value(kind: DiscountKind, value: DiscountValue): string {
      if (value.type === "percent") {
        return t(kind === "automatic" ? "percentEach" : "percentOrder", { percent: value.percentOff });
      }
      const amount = formatCents(value.amountOffCents, value.currency, locale);
      return t(kind === "automatic" ? "amountEach" : "amountOrder", { amount });
    },
    /** "All products" or "3 products". */
    scope(appliesTo: DiscountScope, count: number): string {
      return appliesTo === "all" ? t("allProducts") : t("someProducts", { count });
    },
    kind(kind: DiscountKind): string {
      return t(kind === "code" ? "kindCode" : "kindAutomatic");
    },
    status(status: DiscountStatus): string {
      return t(`status.${status}`);
    },
    /** A date and time in the reader's time zone. */
    when(iso: string): string {
      return formatOrderDateTime(iso, locale);
    },
    /** Totals in each currency the store sold in, joined: "€540.00 · $30.00". */
    money(totals: readonly MoneyTotal[]): string {
      return totals.map((total) => formatCents(total.cents, total.currency, locale)).join(" · ");
    },
  };
}
