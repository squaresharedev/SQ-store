"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import {
  HEADER_BIO_MAX,
  HEADER_NAME_MAX,
  type StorefrontHeader,
} from "@/types/storefront";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { Switch } from "@/components/ui/switch";
import {
  fieldBaseClass,
  helpTextClass,
  labelClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * Store header controls: a show toggle plus the plain text of the two lines
 * rendered as a masthead above the grid. Client caps are UX only — the save
 * path re-validates with the header schema (lengths + control-character rules).
 *
 * The words can also be typed on the canvas itself (click a line), and how
 * they LOOK is only set there: font, size, colour, formatting and alignment
 * come from that same click, which opens this panel on it — the same place
 * every other colour in the storefront is chosen.
 */
export function HeaderSection({
  header,
  onChange,
}: {
  header: StorefrontHeader;
  onChange: (header: StorefrontHeader) => void;
}) {
  const t = useTranslations("Storefront.header");
  const fieldId = useId();

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
      </div>

    </div>
  );
}
