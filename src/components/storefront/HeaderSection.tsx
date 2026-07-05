"use client";

import { useId } from "react";
import {
  HEADER_BIO_MAX,
  HEADER_NAME_MAX,
  type StorefrontHeader,
} from "@/types/storefront";
import { Switch } from "@/components/ui/switch";
import {
  fieldBaseClass,
  helpTextClass,
  labelClass,
} from "@/components/ui/control-styles";

/** Strip control characters as the seller types (newline survives in the bio),
 *  mirroring the server schema so a paste never produces an un-saveable value. */
function sanitize(value: string, allowNewlines: boolean): string {
  const cleaned = allowNewlines
    ? value.replace(/[\p{Cc}]/gu, (char) => (char === "\n" ? char : ""))
    : value.replace(/[\p{Cc}]/gu, "");
  return cleaned;
}

/**
 * Store header controls: a show toggle plus plain-text name + bio rendered as
 * a masthead above the grid. Client caps are UX only — the save path
 * re-validates with the header schema (lengths + control-character rules).
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
        <label htmlFor={`${fieldId}-name`} className={labelClass}>
          Store name
        </label>
        <input
          id={`${fieldId}-name`}
          type="text"
          value={header.name}
          maxLength={HEADER_NAME_MAX}
          placeholder="Store name shown to buyers"
          spellCheck={false}
          onChange={(event) =>
            onChange({ ...header, name: sanitize(event.target.value, false) })
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
            onChange({ ...header, bio: sanitize(event.target.value, true) })
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
