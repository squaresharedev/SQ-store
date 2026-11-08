import { AlignLeft, Barcode, Boxes, Tag, Type, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Disclosure } from "@/components/ui/Disclosure";
import { infoTextClass } from "@/components/ui/control-styles";
import { badgeClass } from "@/components/ui/surface-styles";
import { IMPORT_FIELDS_BY_NEED, IMPORT_REQUIRED_FIELDS, type ImportField } from "@/lib/products/csv";

/** A glyph for each column a file can carry, so the chips can be told apart at a glance. */
const FIELD_ICONS: Record<ImportField, LucideIcon> = {
  title: Type,
  price: Tag,
  description: AlignLeft,
  stock: Boxes,
  sku: Barcode,
};

/** A needed column is solid ink; an optional one is paper with a hairline. */
const NEEDED_CHIP = "bg-primary text-primary-foreground";
const OPTIONAL_CHIP = "bg-background text-muted-foreground ring-1 ring-border";

/** One column's chip: its glyph and its name. */
function ColumnChip({ field, needed }: { field: ImportField; needed: boolean }) {
  const t = useTranslations("Products.import.fields");
  const Icon = FIELD_ICONS[field];
  return (
    <li className={cn(badgeClass, "inline-flex items-center gap-1.5", needed ? NEEDED_CHIP : OPTIONAL_CHIP)} data-import-column={field}>
      <Icon className="size-3" strokeWidth={2} aria-hidden="true" />
      {t(field)}
    </li>
  );
}

/**
 * WHAT A FILE NEEDS, AND WHERE TO GET ONE: the columns as chips (the two a
 * product cannot be built without in ink, the rest quieter) and, folded, how to
 * export the file from Shopify or Etsy. Shown until a file is chosen.
 * Server-compatible.
 */
export function ImportFileHelp() {
  const t = useTranslations("Products.import");
  const tPage = useTranslations("Products.page.import");
  const optional = IMPORT_FIELDS_BY_NEED.filter((field) => !IMPORT_REQUIRED_FIELDS.includes(field));
  return (
    <div className="space-y-3">
      {/* The one-line summary is the accessible name: the chips are its picture. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label={tPage("columnHint")} data-import-columns-hint="">
        <div className="flex flex-wrap items-center gap-2">
          <span className={infoTextClass}>{t("columnsNeeded")}</span>
          <ul className="flex flex-wrap gap-1.5">
            {IMPORT_REQUIRED_FIELDS.map((field) => (
              <ColumnChip key={field} field={field} needed />
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={infoTextClass}>{t("columnsOptional")}</span>
          <ul className="flex flex-wrap gap-1.5">
            {optional.map((field) => (
              <ColumnChip key={field} field={field} needed={false} />
            ))}
          </ul>
        </div>
      </div>
      {/* Collapsed by default: most sellers already have the file. */}
      <Disclosure summary={<span className={infoTextClass}>{tPage("howToGetFile")}</span>}>
        <ul className={`${infoTextClass} space-y-1`}>
          <li>{tPage("howToGetFileShopify")}</li>
          <li>{tPage("howToGetFileEtsy")}</li>
        </ul>
      </Disclosure>
    </div>
  );
}
