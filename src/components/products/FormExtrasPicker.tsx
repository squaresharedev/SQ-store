"use client";

import { Plus, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { focusRingClass, hoverLiftClass, iconPopClass } from "@/components/ui/control-styles";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";
import type { ProductFormSectionId } from "@/lib/products/form-datapoints";

/** The sections offered as optional extras, in form order. Each has a
 *  one-line hint in the catalogue under `Products.form.extras.<id>`. */
export const EXTRA_SECTIONS = [
  "options",
  "photos",
  "badges",
  "specs",
  "documents",
  "safety",
] as const satisfies readonly ProductFormSectionId[];

export type ExtraSectionId = (typeof EXTRA_SECTIONS)[number];

export type FormExtra = {
  id: ExtraSectionId;
  icon: LucideIcon;
  label: string;
};

/**
 * EVERYTHING OPTIONAL, AS A MENU RATHER THAN A WALL.
 *
 * Options, extra photos, badges, specifications, documents and the safety
 * block are each worth having on some products and none of them is needed to
 * sell one. Laid out in full they were six screens of empty inputs a seller
 * had to scroll past to reach Save, which reads as six things still to do.
 * As tiles they read as what they are: extras, one tap each, with a glyph
 * that says what is inside before the words do.
 *
 * A tile opens its section in place (the section then stays open), and a
 * section that already holds something, carries a problem, or was flagged by
 * staff is open from the start, so nothing a seller has entered is ever
 * folded away from them. The grid hides once every extra is open.
 */
export function FormExtrasPicker({
  extras,
  onOpen,
}: {
  /** The extras still closed, in form order. */
  extras: readonly FormExtra[];
  onOpen: (id: ExtraSectionId) => void;
}) {
  const t = useTranslations("Products.form.extras");
  if (extras.length === 0) return null;

  return (
    <section
      aria-labelledby="product-extras-heading"
      className={cn(cardClass, "p-5")}
      data-product-extras=""
    >
      <div className="mb-4 flex items-center gap-3">
        <span className={cn(iconTileClass, "size-9")}>
          <Sparkles className="size-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="product-extras-heading" className="text-base font-semibold text-foreground">
            {t("heading")}
          </h2>
          <p className="font-inter text-xs text-muted-foreground">{t("subheading")}</p>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {extras.map(({ id, icon: Icon, label }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onOpen(id)}
              data-product-extra={id}
              className={cn(
                "group/btn flex size-full flex-col items-start gap-3 rounded-md border border-border bg-background p-3 text-left hover:border-foreground",
                hoverLiftClass,
                focusRingClass,
              )}
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className={cn(iconTileClass, "size-10 rounded-md")}>
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <Plus
                  className={cn("size-4 text-muted-foreground", iconPopClass)}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="font-inter text-xs text-muted-foreground">
                  {t(id)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
