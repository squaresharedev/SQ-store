"use client";

import { useId, useRef, useState } from "react";
import { Trash2, Type } from "lucide-react";
import {
  CUSTOM_FONT_NAME_MAX,
  STOREFRONT_FONTS,
  type StorefrontFont,
  type StorefrontTheme,
} from "@/types/storefront";
import { unexpectedError } from "@/lib/errors";
import { customFontFamily } from "@/lib/theme/storefront-fonts";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  infoTextClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";
import { FONT_LABELS } from "./config-maps";

/** Extra words for the two presets whose names alone do not say what they are. */
const FONT_DESCRIPTIONS: Partial<Record<StorefrontFont, string>> = {
  sans: "The default",
  inter: "Clean and neutral",
  montserrat: "Geometric and wide",
};

/**
 * The file types the picker offers. Deliberately by extension: browsers report
 * font MIME types inconsistently (often as an empty string), so a type-based
 * accept list hides real fonts from the dialog. The server sniffs the bytes.
 */
const FONT_ACCEPT = ".woff2,.woff,.ttf,.otf";

/**
 * Typography: the storefront's typeface, from the built-in set or the seller's
 * own upload.
 *
 * The upload is stored as an R2 object key on the theme and applied through a
 * font face the canvas registers lazily (see CustomFontFace): no preload, and
 * no bytes fetched at all unless something actually renders in it. Choosing a
 * built-in face costs nothing extra either: they all ship with the app already.
 */
export function TypographySection({
  theme,
  onChange,
  fontUrl,
  onFontUrlChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  /** Display URL for the uploaded face (signed, or a local object URL right
   *  after an upload). Null when there is nothing uploaded. */
  fontUrl: string | null;
  /** Reports a new local preview URL after an upload (null on remove). */
  onFontUrlChange: (url: string | null) => void;
}) {
  const fieldId = useId();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // null once the bytes are sent and the server is still working (sniff,
  // store), which shows an indeterminate bar rather than a stalled 100%.
  const [progress, setProgress] = useState<number | null>(0);

  const customFont = theme.customFont;
  const specimenFamily = customFont ? customFontFamily(customFont.key) : null;

  const options: SelectOption<StorefrontFont>[] = STOREFRONT_FONTS.filter(
    // Offered only once there is something to point at.
    (font) => font !== "custom" || customFont !== undefined,
  ).map((font) => ({
    value: font,
    label:
      font === "custom" && customFont
        ? customFont.name
        : FONT_LABELS[font],
    description:
      font === "custom" ? "Your uploaded font" : FONT_DESCRIPTIONS[font],
  }));

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      // Type/size are checked inside uploadToR2 before any network call, so
      // every failure arrives as a structured UploadError with a reason.
      const key = await uploadToR2(file, "font", setProgress);
      onChange({
        ...theme,
        customFont: { key, name: file.name.slice(0, CUSTOM_FONT_NAME_MAX) },
        // Uploading a font is the act of choosing it; leaving the storefront on
        // its old face would make the upload look like it did nothing.
        font: "custom",
      });
      onFontUrlChange(URL.createObjectURL(file));
    } catch (error) {
      // The panel scrolls, so a failure reported inline under the button is
      // routinely off screen by the time it arrives.
      const info =
        error instanceof UploadError
          ? error.info
          : unexpectedError(error instanceof Error ? error.message : undefined);
      toast.error(info.message, { lines: [info.fix] });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeFont() {
    const next = { ...theme };
    delete next.customFont;
    // The stored object is evicted server-side on the next save.
    onChange({
      ...next,
      // Anything still set to the uploaded face would render as plain inherited
      // text, so send the canvas back to the default rather than leave it on a
      // font that no longer exists. Text blocks that opted in do the same by
      // themselves: an unresolvable "custom" simply inherits the canvas.
      font: theme.font === "custom" ? "sans" : theme.font,
    });
    onFontUrlChange(null);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-font`} className={labelClass}>
          Font
        </label>
        <Select
          id={`${fieldId}-font`}
          value={theme.font}
          options={options}
          onChange={(font) => onChange({ ...theme, font })}
        />
      </div>

      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className={labelClass}>Your own font</span>
          <InfoTip label="Which font files work">
            WOFF2, WOFF, TTF or OTF, up to 2 MB. WOFF2 is the one to use:
            it is the smallest, so it is the fastest for a buyer to load, and
            every browser reads it.
          </InfoTip>
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept={FONT_ACCEPT}
          className="sr-only"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={cn(secondaryButtonClass, "w-full")}
        >
          <Type className="size-4" strokeWidth={2} aria-hidden="true" />
          {uploading
            ? progress === null
              ? "Processing…"
              : `Uploading… ${Math.round(progress * 100)}%`
            : customFont
              ? "Replace font"
              : "Upload a font"}
        </button>
        {uploading && <ProgressBar value={progress} label="Uploading font" />}

        {customFont && !uploading && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={cn(infoTextClass, "min-w-0 truncate")}>
                {customFont.name}
              </span>
              <button
                type="button"
                onClick={removeFont}
                className={cn(secondaryButtonClass, "shrink-0 px-2 py-1 text-xs")}
              >
                <Trash2 className="size-3" strokeWidth={2} aria-hidden="true" />
                Remove
              </button>
            </div>

            {/* A specimen, so an upload that landed wrong is visible here
                rather than only on the canvas. It renders in the family the
                canvas registered (this panel and that canvas are always on
                screen together), and is shown only once a display URL exists:
                without one there is no face to specimen. */}
            {specimenFamily && fontUrl && (
              <p
                aria-hidden="true"
                style={{ fontFamily: specimenFamily }}
                className="truncate border border-border px-2 py-1.5 text-base text-foreground"
              >
                Aa Bb Cc 123
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
