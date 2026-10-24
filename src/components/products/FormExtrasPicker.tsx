"use client";

import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AddTile } from "@/components/ui/AddTile";
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
    // Dashed, on the muted surface: a tray of things still to add, not one
    // more card of answers.
    <section
      aria-labelledby="product-extras-heading"
      className="border border-dashed border-border bg-muted/30 p-5"
      data-product-extras=""
    >
      <div className="mb-4">
        <h2 id="product-extras-heading" className="text-base font-semibold text-foreground">
          {t("heading")}
        </h2>
        <p className="font-inter text-xs text-muted-foreground">{t("subheading")}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {extras.map(({ id, icon, label }) => (
          <li key={id}>
            <AddTile
              icon={icon}
              label={label}
              hint={t(id)}
              onClick={() => onOpen(id)}
              data-product-extra={id}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
