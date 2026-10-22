import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, ExternalLink, MoreHorizontal, MousePointerClick, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconButtonClass, overlayItemClass, photoControlClass } from "@/components/ui/control-styles";
import { Popover } from "@/components/ui/Popover";

/**
 * Every action on a product card behind one button: copy link, open page, add
 * to a website, and (for writers) delete. Copy and open stay available to
 * every role (viewing the product page is not a write) and dim when the
 * product is on no storefront, since there is no page to link to yet; the
 * click says so. Sits on the card's photo, so it wears the photo-control skin.
 */
export function ProductCardMenu({
  title,
  canWrite,
  storefrontCount,
  onCopyLink,
  onOpenPage,
  onBuyButton,
  onDelete,
}: {
  title: string;
  /** Delete is write-only and absent for read-only members. */
  canWrite: boolean;
  /** Storefronts the product is on: 0 dims copy/open, 2+ says a choice follows. */
  storefrontCount: number;
  onCopyLink: () => void;
  onOpenPage: () => void;
  onBuyButton: () => void;
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
          <button type="button" onClick={run(onDelete)} className={cn(overlayItemClass, "hover:text-destructive")}>
            <Trash2 className="size-4 shrink-0" aria-hidden="true" />
            {tCommon("delete")}
          </button>
        )}
      </div>
    </Popover>
  );
}
