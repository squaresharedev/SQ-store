import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { subtleFill } from "@/components/product-page/product-page-maps";
import type { SelectionChip } from "@/lib/checkout/selection";
import { EditableText } from "./EditableText";
import { QuantityBadge } from "./QuantityBadge";
import { VersionChips } from "./VersionChips";
import type { ImageFit } from "@/types/storefront";
import type { ProductPageImage } from "@/types/product";
import type { CheckoutTheme } from "./checkout-theme";

/** What every summary of the item shows, whichever layout draws it. */
export type CheckoutItem = {
  title: string;
  photo: ProductPageImage | null;
  /** The version, in the seller's words, with a colour where it has one. */
  chips: SelectionChip[];
  priceCents: number;
  currency: string;
  imageFit: ImageFit;
};

/**
 * THE SHOWCASE: the item a buyer is about to own, large, on the storefront's
 * own backdrop (gradient or photograph included), beside the form. The half
 * of the checkout that is looked at rather than filled in, and the reason this
 * layout exists: the last screen before paying still looks like the shop.
 *
 * ON A NARROW SCREEN it folds to one row (a thumbnail beside the title and
 * price) above the form, so a buyer on a phone reaches the first field
 * without scrolling past a full-width photograph first. The panel keeps the
 * storefront's backdrop either way.
 */
export function CheckoutShowcase({
  item,
  note,
  theme,
}: {
  item: CheckoutItem;
  note: ReactNode;
  theme: CheckoutTheme;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 p-4 @md:p-6 @3xl:sticky @3xl:top-10 @3xl:gap-6 @3xl:p-8",
        theme.panelMatchesSurface && "border",
      )}
      style={{
        ...theme.panelStyle,
        color: theme.panelInk,
        borderRadius: `${theme.surfaceRadius}px`,
        borderColor: theme.rule,
      }}
      data-checkout-showcase=""
      data-setting-hotspot="layout"
    >
      <div className="flex items-center gap-4 @3xl:flex-col @3xl:items-stretch @3xl:gap-6">
        <ItemPhoto
          item={item}
          theme={theme}
          className="size-20 shrink-0 @3xl:aspect-square @3xl:size-auto @3xl:w-full"
        />
        <ItemFacts item={item} ink={theme.panelInk} cornerRadius={theme.cornerRadius} size="lg" />
      </div>
      {note}
    </section>
  );
}

/** The compact layout's summary: a receipt line, not a display. */
export function CheckoutSummaryCard({ item, theme }: { item: CheckoutItem; theme: CheckoutTheme }) {
  return (
    <section
      className="flex items-center gap-4 border p-4"
      // Filled with the surface itself, so on a textured page the order sits
      // on a clean card like the fields below it.
      style={{
        borderColor: theme.rule,
        borderRadius: `${theme.surfaceRadius}px`,
        backgroundColor: theme.surface,
      }}
      data-checkout-summary-card=""
      data-setting-hotspot="layout"
    >
      <ItemPhoto item={item} theme={theme} className="size-20 shrink-0" />
      <ItemFacts item={item} ink={theme.ink} cornerRadius={theme.cornerRadius} size="sm" />
    </section>
  );
}

/** The version's photo, with how many pinned to its corner. */
function ItemPhoto({
  item,
  theme,
  className,
}: {
  item: CheckoutItem;
  theme: CheckoutTheme;
  className: string;
}) {
  if (!item.photo) return null;
  return (
    <div className={cn("relative", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the product gallery's */}
      <img
        src={item.photo.url}
        alt={item.photo.alt}
        className={cn("size-full", item.imageFit === "cover" ? "object-cover" : "object-contain")}
        style={{ borderRadius: `${theme.controlRadius}px` }}
        data-checkout-photo=""
      />
      <QuantityBadge cta={theme.cta} />
    </div>
  );
}

function ItemFacts({
  item,
  ink,
  cornerRadius,
  size,
}: {
  item: CheckoutItem;
  ink: string;
  cornerRadius: number;
  size: "lg" | "sm";
}) {
  const locale = useLocale();
  return (
    <div className={cn("flex min-w-0 flex-col", size === "lg" ? "gap-2 @3xl:gap-3" : "gap-1.5")}>
      <h2 className={cn("font-semibold leading-tight", size === "lg" ? "text-lg @3xl:text-2xl" : "text-base")}>
        {item.title}
      </h2>
      <VersionChips chips={item.chips} ink={ink} cornerRadius={cornerRadius} />
      <p
        className={cn(
          "font-semibold tabular-nums",
          size === "lg" ? "text-base @3xl:text-xl" : "text-sm",
        )}
      >
        {formatCents(item.priceCents, item.currency, locale)}
      </p>
    </div>
  );
}

/**
 * THE MAKER'S NOTE: a few words from the seller, signed with the business
 * name, beside the item (and the thank-you message, in the same frame, on the
 * order page). Plain text only (sellerProse keeps links and payment details out
 * of it), paragraphs kept as the seller typed them.
 *
 * On the canvas the words are typed straight into the note (EditableText). An
 * empty note draws as the note it would be, in the same soft frame, with its
 * invitation in faint ink: no dashed box, nothing that reads as a form field.
 * A buyer never sees an empty one. ONE element tree for empty and written
 * alike, with the same padding and fill, so the first keystroke does not move
 * the words or swap the frame out from under the caret.
 */
export function MakerNote({
  field,
  note,
  signature,
  ink,
  radius,
  preview,
  maxLength,
}: {
  /** Which of the seller's texts this frame holds. */
  field: "note" | "thanksMessage";
  note: string | undefined;
  signature: string;
  ink: string;
  radius: number;
  preview: boolean;
  maxLength: number;
}) {
  const t = useTranslations("ProductPage.checkout.note");
  if (!note && !preview) return null;
  const empty = !note;
  return (
    <figure
      className="flex flex-col gap-2 px-4 py-3.5"
      style={{ backgroundColor: subtleFill(ink), borderRadius: `${radius}px` }}
      // Each note opens its own page's words: the checkout's, or the thank-you's.
      data-setting-hotspot={field === "note" ? "message" : "thanks"}
      data-checkout-note={empty ? "empty" : ""}
    >
      <EditableText
        as="blockquote"
        field={field}
        value={note}
        fallback={field === "note" ? t("placeholder") : t("thanksPlaceholder")}
        fallbackIsPlaceholder
        multiline
        maxLength={maxLength}
        ariaLabel={field === "note" ? t("editNote") : t("editThanks")}
        className="whitespace-pre-line text-sm leading-relaxed"
      />
      {!empty && (
        <figcaption className="text-xs font-medium opacity-70">{t("from", { name: signature })}</figcaption>
      )}
    </figure>
  );
}
