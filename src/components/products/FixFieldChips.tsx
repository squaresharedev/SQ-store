"use client";

import { ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { focusRingClass } from "@/components/ui/control-styles";
import { flagChipClass } from "@/components/ui/surface-styles";
import {
  PRODUCT_FIX_FIELD_SECTION,
  fixFieldLabel,
  type FixTarget,
  type ProductFixField,
} from "@/lib/moderation/fix-fields";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { jumpToSection } from "./FormSectionNav";

/**
 * The parts staff asked the seller to change, as a row of chips.
 *
 * On a paused product's edit page each chip is a button that scrolls to the
 * section holding that part, which is lit up the same way: the banner says
 * WHAT, one click shows WHERE. Everywhere else (a storefront, whose editor is
 * a separate full-screen page, or a removal, where there is nothing left to
 * fix) they are plain labels.
 */
export function FixFieldChips({
  target,
  fields,
  interactive = false,
}: {
  target: FixTarget;
  fields: readonly string[];
  /** Buttons that jump to the matching section of the product form. */
  interactive?: boolean;
}) {
  const t = useTranslations("Products.removal");
  const resolve = useResolveMessage();

  return (
    <ul className="flex flex-wrap gap-1.5" data-fix-fields="">
      {fields.map((field) => {
        const label = resolve(fixFieldLabel(target, field));
        const section =
          target === "product" ? PRODUCT_FIX_FIELD_SECTION[field as ProductFixField] : null;
        return (
          <li key={field}>
            {interactive && section ? (
              <button
                type="button"
                onClick={() => jumpToSection(section)}
                aria-label={t("showField", { field: label })}
                className={cn(flagChipClass, "hover:bg-foreground/85", focusRingClass)}
                data-fix-field={field}
              >
                {label}
                <ArrowDown className="size-3" strokeWidth={2.25} aria-hidden="true" />
              </button>
            ) : (
              <span className={flagChipClass} data-fix-field={field}>
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
