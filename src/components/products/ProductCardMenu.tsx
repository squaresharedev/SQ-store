import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, Copy, ExternalLink, Files, MoreHorizontal, MousePointerClick, PenLine, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconButtonClass, overlayItemClass, photoControlClass } from "@/components/ui/control-styles";
import { Popover } from "@/components/ui/Popover";
import type { ProductStatus } from "@/types/product";

/**
 * Every action on a product card behind one button: copy link, open page, add
 * to a website, (for writers) duplicate / status toggle / delete. Copy and
 * open stay available to every role (viewing the product page is not a write)
 * and dim when the product is on no storefront. Sits on the card's photo, so
 * it wears the photo-control skin.
 */
export function ProductCardMenu({
  title,
  status,
  canWrite,
  storefrontCount,
  onCopyLink,
  onOpenPage,
  onBuyButton,
  onDuplicate,
  onMakeActive,
  onMakeDraft,
  onDelete,
}: {
  title: string;
  status: ProductStatus;
  /** Delete, duplicate and status actions are write-only. */
  canWrite: boolean;
  /** Storefronts the product is on: 0 dims copy/open, 2+ says a choice follows. */
  storefrontCount: number;
  onCopyLink: () => void;
  onOpenPage: () => void;
  onBuyButton: () => void;
  onDuplicate: () => void;
  onMakeActive: () => void;
  onMakeDraft: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("Products.card");
  const tCommon = useTranslations("Common.actions");
  const unplaced = storefrontCount === 0;
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      variant="anchored"
      // Opens DOWN: the button is in the card's top corner, so "above" would run
      // off the top of the page on the first row. w-52 keeps the panel inside
      // the card's own width at the grid's narrowest (14rem less the inset).
      placement="below"
      label={t("actions", { title })}
      rootClassName="relative z-10 w-auto shrink-0"
      // On a phone the shared dropdown pins to the screen's top corner; this one
      // stays under the button it belongs to.
      panelClassName="w-52 p-1 max-sm:absolute max-sm:right-0 max-sm:top-full max-sm:mt-2"
      trigger={
        <button
          type="button"
          aria-label={t("moreActions", { title })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(iconButtonClass, photoControlClass, "size-7")}
        >
          <MoreHorizontal className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      }
    >
      <div className="py-1">
        <button
          type="button"
          onClick={run(onCopyLink)}
          title={unplaced ? t("notPlaced") : storefrontCount === 1 ? t("copyLinkTitle") : t("chooseStorefront", { count: storefrontCount })}
          className={cn(overlayItemClass, unplaced && "opacity-40")}
        >
          <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("copyLink")}
        </button>
        <button
          type="button"
          onClick={run(onOpenPage)}
          title={unplaced ? t("notPlaced") : t("openPage")}
          className={cn(overlayItemClass, unplaced && "opacity-40")}
        >
          <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("openPage")}
        </button>
        {/* Every role: the dialog only hands out a link, and explains for
            itself when there is nothing to link to yet. */}
        <button type="button" onClick={run(onBuyButton)} className={overlayItemClass}>
          <MousePointerClick className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("addToWebsite")}
        </button>
        {canWrite && (
          <>
            {/* Quick status toggle: draft -> active, active -> draft. */}
            {status === "draft" ? (
              <button type="button" onClick={run(onMakeActive)} className={overlayItemClass}>
                <CheckCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {t("makeActive")}
              </button>
            ) : (
              <button type="button" onClick={run(onMakeDraft)} className={overlayItemClass}>
                <PenLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {t("makeDraft")}
              </button>
            )}
            <button type="button" onClick={run(onDuplicate)} className={overlayItemClass}>
              <Files className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {t("duplicate")}
            </button>
            <button type="button" onClick={run(onDelete)} className={cn(overlayItemClass, "hover:text-destructive")}>
              <Trash2 className="size-4 shrink-0" aria-hidden="true" />
              {tCommon("delete")}
            </button>
          </>
        )}
      </div>
    </Popover>
  );
}
