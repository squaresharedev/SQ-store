"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquareQuote, MoreHorizontal } from "lucide-react";
import Link from "@/components/ui/AppLink";
import { overlayItemClass } from "@/components/ui/control-styles";
import { Popover } from "@/components/ui/Popover";
import { UploadIcon } from "@/components/ui/UploadIcon";
import { PRODUCTS_IMPORT_PATH } from "@/lib/products/paths";
import { REVIEWS_PATH } from "@/lib/reviews/paths";
import { cn } from "@/lib/utils";

/**
 * The products toolbar's "More" button: Reviews and (for writers) Import,
 * where the row is too narrow to give each its own labelled button. From the
 * width where they fit (ProductsBrowser) they are buttons again and this is
 * not drawn. A dropdown under the button at every width, like the card menu,
 * not a bottom sheet: two rows do not need one.
 */
export function ProductsMoreMenu({
  canWrite,
  triggerClassName,
  className,
}: {
  /** Import is a write; Reviews is for every member. */
  canWrite: boolean;
  triggerClassName?: string;
  /** Classes for the menu's root, e.g. the breakpoint that hides it. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("Products.browser");
  const close = () => setOpen(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      variant="anchored"
      label={t("moreActions")}
      rootClassName={cn("w-auto shrink-0", className)}
      // On a phone the shared dropdown pins to the screen's top corner; this
      // one stays under the button it belongs to (as ProductCardMenu does).
      panelClassName="w-52 p-1 max-sm:absolute max-sm:right-0 max-sm:top-full max-sm:mt-2"
      trigger={
        <button
          type="button"
          aria-label={t("moreActions")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={triggerClassName}
          data-products-more=""
        >
          <MoreHorizontal className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      }
    >
      <div className="py-1">
        <Link href={REVIEWS_PATH} onClick={close} className={overlayItemClass}>
          <MessageSquareQuote className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
          {t("reviews")}
        </Link>
        {canWrite && (
          <Link href={PRODUCTS_IMPORT_PATH} onClick={close} className={overlayItemClass}>
            <UploadIcon className="size-4 shrink-0 text-muted-foreground" />
            {t("import")}
          </Link>
        )}
      </div>
    </Popover>
  );
}
