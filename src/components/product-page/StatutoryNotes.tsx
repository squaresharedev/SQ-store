import { useTranslations } from "next-intl";

/**
 * Fixed consumer-law lines for EU sellers. Ours, not the seller's: a seller
 * cannot omit the right of withdrawal or the conformity guarantee from an
 * offer, so the page states them whatever the returns text says.
 *
 * LEGAL TEXT. `ProductPage.statutory.*` must be reviewed per language before a
 * translation ships; a paraphrase here misstates a buyer's rights.
 */
export function StatutoryNotes({ isDigital }: { isDigital: boolean }) {
  const t = useTranslations("ProductPage.statutory");
  return (
    <ul className="flex flex-col gap-1 text-xs opacity-70" data-product-statutory="">
      <li>{t("withdrawal")}</li>
      {isDigital && <li>{t("digitalWithdrawal")}</li>}
      <li>{t("guarantee")}</li>
    </ul>
  );
}
