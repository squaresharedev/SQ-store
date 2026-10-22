import { useTranslations } from "next-intl";
import type { ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";
import { photoChipClass } from "@/components/ui/surface-styles";

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
  const t = useTranslations("Products.status");
  if (status === "active") return null;

  return (
    <span className={cn(photoChipClass, "bg-background/95 text-foreground", className)}>{t("draft")}</span>
  );
}

/**
 * An ACTIVE product on no storefront has no page yet, so no buyer can reach
 * it: the same kind of fact as a draft, and said the same way on the photo.
 * Quieter than Draft (muted ink): nothing is wrong, it just is not placed.
 */
export function UnplacedBadge({ className }: { className?: string }) {
  const t = useTranslations("Products.card");
  return (
    <span className={cn(photoChipClass, "bg-background/95 text-muted-foreground", className)} title={t("notPlaced")}>
      {t("noStorefront")}
    </span>
  );
}
