"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Palette } from "lucide-react";
import {
  HEADER_BIO_MAX,
  HEADER_NAME_MAX,
  type HeaderLine,
  type StorefrontHeader,
} from "@/types/storefront";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { Switch } from "@/components/ui/switch";
import {
  fieldBaseClass,
  helpTextClass,
  labelClass,
  quietIconLinkClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * Store header controls: a show toggle plus the plain text of the two lines
 * rendered as a masthead above the grid. Client caps are UX only: the save
 * path re-validates with the header schema (lengths + control-character rules).
 *
 * The words can also be typed on the canvas itself (click a line). How they
 * LOOK (font, size, colour, formatting and alignment) is set in the colour
 * panel, aimed at that line, the same place every other colour in the
 * storefront is chosen. Clicking the line opens it, and so does the link under
 * each field here, which is how a seller who never thought to click the
 * canvas finds it.
 */
export function HeaderSection({
  header,
  onChange,
  onStyleLine,
}: {
  header: StorefrontHeader;
  onChange: (header: StorefrontHeader) => void;
  /** Open the colour panel on one line, as clicking it on the canvas does.
   *  Absent (the dev gallery) drops the links rather than show dead ones. */
  onStyleLine?: (line: HeaderLine) => void;
}) {
  const t = useTranslations("Storefront.header");
  const fieldId = useId();

  /** The way to a line's font and colour, under its field. */
  const styleLink = (line: HeaderLine) =>
    onStyleLine && (
      <button
        type="button"
        onClick={() => onStyleLine(line)}
        className={quietIconLinkClass}
        data-header-style={line}
      >
        <Palette className="size-3.5" strokeWidth={2} aria-hidden="true" />
        {t("styleLine", { line })}
      </button>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-show`} className={labelClass}>
          {t("showHeader")}
        </label>
        <Switch
          id={`${fieldId}-show`}
          checked={header.show}
          onCheckedChange={(show) => onChange({ ...header, show })}
        />
      </div>

      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <label htmlFor={`${fieldId}-name`} className={labelClass}>
            {t("storeName")}
          </label>
          <InfoTip label={t("infoLabel")}>
            {t("infoBody")}
          </InfoTip>
        </span>
        <input
          id={`${fieldId}-name`}
          type="text"
          value={header.name}
          maxLength={HEADER_NAME_MAX}
          placeholder={t("storeNamePlaceholder")}
          spellCheck={false}
          onChange={(event) =>
            onChange({
              ...header,
              name: sanitizeHeaderText(event.target.value, false),
            })
          }
          className={fieldBaseClass}
        />
        {styleLink("name")}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-bio`} className={labelClass}>
          {t("bio")}
        </label>
        <textarea
          id={`${fieldId}-bio`}
          value={header.bio}
          maxLength={HEADER_BIO_MAX}
          rows={2}
          placeholder={t("bioPlaceholder")}
          onChange={(event) =>
            onChange({
              ...header,
              bio: sanitizeHeaderText(event.target.value, true),
            })
          }
          className={fieldBaseClass}
        />
        <p className={helpTextClass}>
          {t("charsLeft", { n: HEADER_BIO_MAX - header.bio.length })}
        </p>
        {styleLink("bio")}
      </div>

    </div>
  );
}
