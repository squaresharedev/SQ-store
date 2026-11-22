"use client";

import { useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Check, EyeOff, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { optionSwatch, photoForSelection, previewSelection } from "@/lib/checkout/selection";
import type { AddOnCard, AddOnHiddenReason, HiddenAddOn } from "@/types/product";
import {
  DEFAULT_PRODUCT_PAGE_ADD_ON_LAYOUT,
  type ProductPageAddOnLayout,
  type ProductPageSaleStyle,
} from "@/types/storefront";
import { useAddOns } from "./AddOnsContext";
import { AddOnDetails } from "./AddOnDetails";
import { PageSelect } from "./PageSelect";
import { SalePrice } from "./SalePrice";
import { readableOn, subtleFill } from "./product-page-maps";
import { usePickersBeside } from "./usePickersBeside";

/** The keyboard ring on the things a buyer presses; its colour is the page's ink. */
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/** The tiles look: small photo tiles, as many across as fit (four in a
 *  desktop buy box, three on a phone), never stretched to fill the row. */
const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2";

/** Each reason's word on a faded card (the closed-list map, not a built key). */
const HIDDEN_REASON_LABELS = {
  takenDown: "hidden.takenDown",
  otherKind: "hidden.otherKind",
  otherCurrency: "hidden.otherCurrency",
  draft: "hidden.draft",
  soldOut: "hidden.soldOut",
} as const satisfies Record<AddOnHiddenReason, string>;

const NO_HIDDEN: readonly HiddenAddOn[] = [];

/**
 * "ADD TO YOUR ORDER", in the buy box: the seller's other products, each one
 * tap from being in the same order.
 *
 * TWO THINGS TO PRESS ON EACH, because a buyer wants two different things:
 * the product itself (its photo and name) opens its details, and "Add" puts it
 * in the order. A taken one with versions shows its choice beside it (a row's
 * picker, or a tile's line naming it, changed in the details).
 *
 * How it looks is the storefront's (the designer's "Add to your order"
 * section): its heading in the seller's words, rows or photo tiles. Drawn in
 * the page's own ink and corners, nothing of its own. In the editor a product
 * with none to offer draws the section as a dashed outline, the way the unwired
 * buy button does; clicking it opens the panel where they are chosen. The
 * seller's previews also draw what was chosen but is not offered (`hidden`),
 * faded with the reason, so four chosen never shows as two.
 */
export function AddOnsSection({
  ink,
  rule,
  radius,
  saleStyle,
  title,
  layout = DEFAULT_PRODUCT_PAGE_ADD_ON_LAYOUT,
  preview,
  hidden = NO_HIDDEN,
  starColor,
}: {
  ink: string;
  rule: string;
  radius: number;
  saleStyle?: ProductPageSaleStyle;
  /** The seller's own heading; absent = "Add to your order". */
  title?: string;
  layout?: ProductPageAddOnLayout;
  preview: boolean;
  /** The seller's previews only: chosen, but not offered to buyers. */
  hidden?: readonly HiddenAddOn[];
  /** The page's star colour, for each add-on's rating in its details. Absent
   *  where the page shows no reviews, and then no ratings either. */
  starColor?: string;
}) {
  const t = useTranslations("ProductPage.addOns");
  const { offered, isAdded, toggle, add, remove, picks, choose } = useAddOns();
  const [looking, setLooking] = useState<string | null>(null);
  const heading = title || t("title");

  if (offered.length === 0 && hidden.length === 0) {
    if (!preview) return null;
    return (
      <section
        className="flex flex-col gap-1 border border-dashed px-4 py-3 text-sm"
        style={{ borderColor: rule, borderRadius: radius }}
        data-product-add-ons="unset"
        data-setting-hotspot="addOns"
      >
        <p className="font-semibold">{heading}</p>
        <p className="opacity-70">{t("unset")}</p>
      </section>
    );
  }

  const lookingAt = offered.find((card) => card.id === looking) ?? null;
  const optionIdsOf = (id: string) => picks.find((pick) => pick.productId === id)?.optionIds ?? [];

  return (
    <section
      aria-labelledby="product-add-ons-title"
      className="flex flex-col gap-2"
      data-product-add-ons={picks.length}
      data-product-add-ons-layout={layout}
    >
      {/* The heading is the section's setting in the editor; the cards are
          the buyer's to press, there too. */}
      <h2 id="product-add-ons-title" className="text-base font-semibold" data-setting-hotspot="addOns">
        {heading}
      </h2>
      <ul className={layout === "tiles" ? TILE_GRID : "flex flex-col gap-2"}>
        {offered.map((card) => (
          <AddOnItem
            key={card.id}
            card={card}
            layout={layout}
            added={isAdded(card.id)}
            optionIds={optionIdsOf(card.id)}
            onToggle={() => toggle(card.id)}
            onOpen={() => setLooking(card.id)}
            onChoose={(groupId, optionId) => choose(card.id, groupId, optionId)}
            ink={ink}
            rule={rule}
            radius={radius}
            saleStyle={saleStyle}
          />
        ))}
        {hidden.map((entry) => (
          <HiddenAddOnItem key={entry.id} entry={entry} layout={layout} ink={ink} rule={rule} radius={radius} />
        ))}
      </ul>
      {lookingAt && (
        <AddOnDetails
          // Fresh each time it opens, so its version starts from the order's.
          key={lookingAt.id}
          card={lookingAt}
          open
          onClose={() => setLooking(null)}
          added={isAdded(lookingAt.id)}
          pickedOptionIds={optionIdsOf(lookingAt.id)}
          onAdd={(optionIds) => add(lookingAt.id, optionIds)}
          onRemove={() => remove(lookingAt.id)}
          saleStyle={saleStyle}
          radius={radius}
          starColor={starColor}
          preview={preview}
        />
      )}
    </section>
  );
}

/**
 * A chosen product buyers are not offered, as the seller's preview draws it:
 * faded, dashed, and why (an eye struck through, "Draft"). Nothing on it
 * presses; in the editor a click opens the panel where it can be taken off.
 */
function HiddenAddOnItem({
  entry,
  layout,
  ink,
  rule,
  radius,
}: {
  entry: HiddenAddOn;
  layout: ProductPageAddOnLayout;
  ink: string;
  rule: string;
  radius: number;
}) {
  const t = useTranslations("ProductPage.addOns");
  const tiles = layout === "tiles";
  return (
    <li
      className={cn("border border-dashed", tiles ? "flex flex-col gap-1.5 p-1.5" : "flex items-center gap-3 p-2")}
      style={{ borderColor: rule, borderRadius: radius }}
      title={t("hidden.hint")}
      data-product-add-on-hidden={entry.id}
      data-product-add-on-hidden-reason={entry.reason}
      data-setting-hotspot="addOns"
    >
      <span
        className={cn("shrink-0 overflow-hidden opacity-40", tiles ? "aspect-square w-full" : "size-14")}
        style={{ borderRadius: addOnInnerRadius(radius), background: subtleFill(ink) }}
        aria-hidden="true"
      >
        {entry.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
          <img src={entry.imageUrl} alt="" draggable={false} decoding="async" className="size-full object-cover" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate font-medium opacity-60", tiles ? "text-xs" : "text-sm")}>{entry.title}</span>
        <span className="inline-flex items-center gap-1 text-xs font-medium">
          <EyeOff className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span className="truncate">{t(HIDDEN_REASON_LABELS[entry.reason])}</span>
          <span className="sr-only">{t("hidden.hint")}</span>
        </span>
      </span>
    </li>
  );
}

/** The corners of what sits inside an add-on's card, a step in from its own. */
export function addOnInnerRadius(radius: number): number {
  return Math.max(0, radius - 4);
}

/** An add-on card's frame: the page's hairline, the same whether it is in the
 *  order or not. The filled "Added" button is what says it is taken. */
export function addOnFrameStyle(rule: string, radius: number): CSSProperties {
  return { borderColor: rule, borderRadius: radius };
}

/** The height of every control in an add-on row: Add, and the version
 *  pickers beside it, so they line up as one strip. */
const ADD_ON_CONTROL_HEIGHT = "h-10";

/**
 * An add-on row's box. The photo (size-14, 56px) sits 8px in; the right inset
 * is the 40px button's distance from the top and bottom as well: centred on
 * the photo, it has 8px + 8px above and below, so 16px on the right too.
 * Shared with the product form's ghost rows, so the two never drift apart.
 */
export const ADD_ON_ROW_CLASS = "border py-2 pl-2 pr-4";

/** The add button's two sizes: a row's, and a small tile's. */
const ADD_BUTTON_SIZE = {
  md: { button: cn(ADD_ON_CONTROL_HEIGHT, "gap-1.5 px-3 text-sm"), icon: "size-4" },
  sm: { button: "gap-1 px-2 py-1 text-xs", icon: "size-3.5" },
} as const;

/** The "+ Add" that becomes "✓ Added", in the page's ink and corners. */
export function AddOnAddButton({
  added,
  ink,
  rule,
  radius,
  size = "md",
  className,
  ...button
}: Omit<ComponentProps<"button">, "children" | "style"> & {
  added: boolean;
  ink: string;
  rule: string;
  radius: number;
  size?: keyof typeof ADD_BUTTON_SIZE;
}) {
  const t = useTranslations("ProductPage.addOns");
  const inner = addOnInnerRadius(radius);
  const sized = ADD_BUTTON_SIZE[size];
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border font-medium",
        sized.button,
        "transition-colors duration-base ease-standard motion-reduce:transition-none",
        className,
      )}
      style={
        added
          ? { background: ink, borderColor: ink, color: readableOn(ink), borderRadius: inner, outlineColor: ink }
          : { borderColor: rule, borderRadius: inner, outlineColor: ink }
      }
      {...button}
    >
      {added ? (
        <Check className={sized.icon} strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <Plus className={sized.icon} strokeWidth={2.25} aria-hidden="true" />
      )}
      {added ? t("added") : t("add")}
    </button>
  );
}

function AddOnItem({
  card,
  layout,
  added,
  optionIds,
  onToggle,
  onOpen,
  onChoose,
  ink,
  rule,
  radius,
  saleStyle,
}: {
  card: AddOnCard;
  layout: ProductPageAddOnLayout;
  added: boolean;
  optionIds: readonly string[];
  onToggle: () => void;
  onOpen: () => void;
  onChoose: (groupId: string, optionId: string) => void;
  ink: string;
  rule: string;
  radius: number;
  saleStyle?: ProductPageSaleStyle;
}) {
  const t = useTranslations("ProductPage.addOns");
  const selection = added
    ? Object.fromEntries(
        card.optionGroups.flatMap((group) => {
          const option = group.options.find((candidate) => optionIds.includes(candidate.id));
          return option ? [[group.id, option]] : [];
        }),
      )
    : previewSelection(card.optionGroups);
  const photo = photoForSelection(card.images, selection);
  const inner = addOnInnerRadius(radius);
  const tiles = layout === "tiles";
  // A row in the order with versions to choose draws its pickers inside the
  // card: beside Add where the name and price still show whole, else on a
  // line of their own under them.
  const hasPickers = !tiles && added && card.optionGroups.length > 0;
  const { ref: rowRef, beside } = usePickersBeside(hasPickers, optionIds.join());

  const picture = (
    <span
      className={cn("shrink-0 overflow-hidden", tiles ? "aspect-square w-full" : "size-14")}
      style={{ borderRadius: inner, background: subtleFill(ink) }}
      aria-hidden="true"
      data-product-add-on-photo=""
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
        <img src={photo.url} alt="" draggable={false} decoding="async" className="size-full object-cover" />
      )}
    </span>
  );

  // A tile is small: its name and price, and the photo says "look closer".
  // A taken one names its version in a line of its own; the details it opens
  // are where a buyer changes it (a picker would not fit a tile).
  const chosenVersion =
    tiles && added
      ? card.optionGroups.flatMap((group) => (selection[group.id] ? [selection[group.id]!.name] : [])).join(", ")
      : "";
  // A row's three lines fill the photo's 56px exactly (20 + 20 + 16), so the
  // photo sets the row's height and the button's even inset holds. Each line
  // is as wide as its words (`items-start`), which is what the fit measures.
  const words = (
    <span
      className={cn("flex min-w-0 flex-1 flex-col items-start", tiles ? "gap-0.5" : "gap-0")}
      data-product-add-on-words=""
    >
      <span className={cn("max-w-full truncate font-medium", tiles ? "text-xs" : "text-sm")}>{card.title}</span>
      <SalePrice
        priceCents={card.priceCents}
        currency={card.currency}
        sale={card.sale}
        priceClassName={tiles ? "text-xs" : "text-sm"}
        size="sm"
        saleStyle={saleStyle}
      />
      {chosenVersion && (
        <span className="max-w-full truncate text-xs underline underline-offset-2 opacity-70" data-product-add-on-version="">
          {chosenVersion}
        </span>
      )}
      {!tiles && <span className="text-xs underline underline-offset-2 opacity-70">{t("seeDetails")}</span>}
    </span>
  );

  const addButton = (
    <AddOnAddButton
      added={added}
      ink={ink}
      rule={rule}
      radius={radius}
      size={tiles ? "sm" : "md"}
      aria-pressed={added}
      aria-label={t("addNamed", { title: card.title })}
      onClick={onToggle}
      // A tile's button sits at its foot, so a row's buttons line up even
      // where a sale price takes two lines. A row's is the last column of
      // its first line, whichever side of it the pickers are.
      className={cn(tiles ? "mt-auto w-full" : cn("row-start-1", beside ? "col-start-3" : "col-start-2"), FOCUS_RING)}
      data-product-add-on-toggle=""
    />
  );

  // One dropdown per group, each as wide as its words up to a cap; a colour
  // group's carries the colour as a dot.
  const pickers = hasPickers && (
    <div
      className={cn("flex gap-2", beside ? "col-start-2 row-start-1" : "col-span-full row-start-2 flex-wrap")}
      data-product-add-on-pickers={beside ? "beside" : "below"}
    >
      {card.optionGroups.map((group) => {
        const chosen = selection[group.id];
        return (
          <PageSelect
            key={group.id}
            id={`add-on-${card.id}-${group.id}`}
            label={t("optionLabel", { group: group.name, product: card.title })}
            value={chosen?.id ?? ""}
            options={group.options.map((option) => ({
              value: option.id,
              label: option.name,
              disabled: !option.available,
              swatch: optionSwatch(group, option),
            }))}
            onChange={(optionId) => onChoose(group.id, optionId)}
            radius={radius}
            ink={ink}
            className="min-w-0 max-w-44 shrink-0"
            // A touch tighter than the page's own picker, so one fits beside
            // Add in a desktop buy box more often.
            triggerClassName={cn(ADD_ON_CONTROL_HEIGHT, "gap-1.5 px-2.5 py-0")}
          />
        );
      })}
    </div>
  );

  const frame = addOnFrameStyle(rule, radius);
  const detailsButton = (children: ReactNode) => (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("detailsNamed", { title: card.title })}
      aria-haspopup="dialog"
      className={cn("flex min-w-0 text-left", tiles ? "flex-col gap-1.5" : "flex-1 items-center gap-3", FOCUS_RING)}
      style={{ borderRadius: inner, outlineColor: ink }}
      data-product-add-on-details=""
    >
      {children}
    </button>
  );

  // Each card is the buyer's to press, in the editor too: a click on it is no
  // page setting (the heading and the faded cards are).
  if (tiles) {
    return (
      <li
        className="flex flex-col border"
        style={frame}
        data-product-add-on={card.id}
        data-product-add-on-state={added ? "added" : "offered"}
        data-setting-skip=""
      >
        <div className="flex flex-1 flex-col gap-1.5 p-1.5">
          {detailsButton(
            <>
              {picture}
              {words}
            </>,
          )}
          {addButton}
        </div>
      </li>
    );
  }

  // A grid, so the pickers move between beside and below without being drawn
  // twice. Button before pickers in the markup: once a buyer adds, the next
  // Tab is the version.
  return (
    <li data-product-add-on={card.id} data-product-add-on-state={added ? "added" : "offered"} data-setting-skip="">
      <div
        ref={rowRef}
        className={cn(
          ADD_ON_ROW_CLASS,
          "grid items-center gap-2",
          beside ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
        )}
        style={frame}
      >
        {detailsButton(
          <>
            {picture}
            {words}
          </>,
        )}
        {addButton}
        {pickers}
      </div>
    </li>
  );
}
