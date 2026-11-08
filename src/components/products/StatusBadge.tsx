import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import Link from "@/components/ui/AppLink";
import type { ProductStatus } from "@/types/product";
import { cn } from "@/lib/utils";
import { focusRingClass, iconNudgeRightClass, transitionClass } from "@/components/ui/control-styles";
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
 *
 * Given `href` (a writer's card), it is also the way to fix that, a tap away
 * on a phone, where the hint never shows: the storefronts, where a product is
 * placed.
 */
export function UnplacedBadge({ href, className }: { href?: string; className?: string }) {
  const t = useTranslations("Products.card");
  const chip = cn(photoChipClass, "bg-background/95 text-muted-foreground", className);
  if (!href) {
    return (
      <span className={chip} title={t("notPlaced")}>
        {t("noStorefront")}
      </span>
    );
  }
  return (
    // Above the card's stretched editor link, like every control on the photo.
    <Link
      href={href}
      title={t("notPlaced")}
      className={cn(chip, "group/btn relative z-10 hover:text-foreground", transitionClass, focusRingClass)}
    >
      {t("noStorefront")}
      <ArrowRight className={cn("size-3 shrink-0", iconNudgeRightClass)} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}
