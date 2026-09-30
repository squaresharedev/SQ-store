"use client";

import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { HeaderLine } from "@/types/storefront";
import { HEADER_LINE_MAX, headerLineAllowsNewlines } from "@/lib/storefront/header-text";
import type { TextRange } from "@/lib/storefront/text-selection";
import { PlainTextEditor } from "./PlainTextEditor";

/**
 * A masthead line, typed where it reads: clicking the store name or the bio on
 * the canvas turns that line into this, with the caret already in the words
 * the seller aimed at.
 *
 * The editing itself is PlainTextEditor's (shared with the checkout artboards);
 * what is the masthead's here is which line it is: the store name is a heading
 * and one line, the bio is prose, and each has its own cap and format flags.
 */
export function MastheadLineEditor({
  line,
  value,
  initialRange = null,
  className,
  style,
  onChange,
  onToggleFormat,
  onDone,
}: {
  line: HeaderLine;
  value: string;
  initialRange?: TextRange | null;
  className: string;
  style: CSSProperties;
  onChange: (value: string) => void;
  /** Ctrl+B / I / U: the line has its own bold/italic/underline flags, and the
   *  window-level shortcut deliberately stays out of any field. */
  onToggleFormat: (format: "bold" | "italic" | "underline") => void;
  /** Escape, or focus leaving the line. */
  onDone: () => void;
}) {
  const t = useTranslations("Storefront.masthead");
  return (
    <PlainTextEditor
      // The tag the line reads as, unchanged by the edit: the store name is a
      // heading whether or not there is a caret in it.
      as={line === "name" ? "h2" : "p"}
      value={value}
      multiline={headerLineAllowsNewlines(line)}
      maxLength={HEADER_LINE_MAX[line]}
      ariaLabel={line === "name" ? t("editorNameAriaLabel") : t("editorBioAriaLabel")}
      placeholder={line === "name" ? "Store name" : "Add a short bio"}
      initialRange={initialRange}
      className={className}
      style={style}
      onChange={onChange}
      onToggleFormat={onToggleFormat}
      onDone={onDone}
    />
  );
}
