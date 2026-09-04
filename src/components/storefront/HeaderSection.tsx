"use client";

import { useId } from "react";
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
 * The words can also be typed on the canvas itself (double-click a line), and
 * how they LOOK is only set there: font, size, colour, formatting and
 * alignment come from clicking the line, which opens the left-hand panel on
 * it — the same place every other colour in the storefront is chosen, and the
 * same gesture that selects anything else on the board.
 */
export function HeaderSection({
  header,
  onChange,
}: {
  header: StorefrontHeader;
  onChange: (header: StorefrontHeader) => void;
}) {
  const fieldId = useId();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-show`} className={labelClass}>
          Show header
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
            Store name
          </label>
          <InfoTip label="Other ways to edit the header">
            Double-click the name or bio on the canvas to type it there. A
            single click aims this panel at that line, where its font, size,
            colour, formatting and alignment are set.
          </InfoTip>
        </span>
        <input
          id={`${fieldId}-name`}
          type="text"
          value={header.name}
          maxLength={HEADER_NAME_MAX}
          placeholder="Store name shown to buyers"
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
          Bio
        </label>
        <textarea
          id={`${fieldId}-bio`}
          value={header.bio}
          maxLength={HEADER_BIO_MAX}
          rows={2}
          placeholder="A short line about your shop"
          onChange={(event) =>
            onChange({
              ...header,
              bio: sanitizeHeaderText(event.target.value, true),
            })
          }
          className={fieldBaseClass}
        />
        <p className={helpTextClass}>
          {HEADER_BIO_MAX - header.bio.length} characters left
        </p>
      </div>

    </div>
  );
}
