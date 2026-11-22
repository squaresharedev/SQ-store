"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Type } from "lucide-react";
import {
  CUSTOM_FONT_NAME_MAX,
  FONT_PAIRINGS,
  STOREFRONT_FONTS,
  type FontPairing,
  type StorefrontFont,
  type StorefrontTheme,
} from "@/types/storefront";
import { unexpectedError } from "@/lib/errors";
import { customFontFamily } from "@/lib/theme/storefront-fonts";
import { isFontPairing } from "@/lib/theme/font-pairings";
import { FONT_PAIRING_LABELS } from "@/lib/theme/font-pairing-labels";
import { fontPairingPresentation } from "@/lib/theme/font-pairing-presentation";
import { fontRoleStyle } from "@/lib/theme/font-roles";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { sampleObjectKey } from "@/lib/storefront/sample";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import { cn } from "@/lib/utils";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  infoTextClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";
import { FONT_LABELS } from "./config-maps";
import { MoreDisclosure } from "./MoreDisclosure";
import { TextStylesEditor } from "./TextStylesEditor";

/** The theme without a pairing: a single font is in charge again. */
function withoutPairing(theme: StorefrontTheme): StorefrontTheme {
  const next = { ...theme };
  delete next.fontPairing;
  return next;
}

/**
 * The file types the picker offers. Deliberately by extension: browsers report
 * font MIME types inconsistently (often as an empty string), so a type-based
 * accept list hides real fonts from the dialog. The server sniffs the bytes.
 */
const FONT_ACCEPT = ".woff2,.woff,.ttf,.otf";

/**
 * Typography: the storefront's FONT PAIRING first (a headline face and a body
 * face under one name, each shown in its own faces), then the seller's own
 * upload. Behind "More": the single-font list this section used to lead with
 * (choosing from it turns the pairing off, since a pairing wins over it), and
 * the saved text styles.
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
  const t = useTranslations("Storefront.typography");
  const tType = useTranslations("EditorType.panel.typography");
  const tRoot = useTranslations();
  const fieldId = useId();
  const showActionError = useActionErrorToast();
  const sample = useSampleMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // null once the bytes are sent and the server is still working (sniff,
  // store), which shows an indeterminate bar rather than a stalled 100%.
  const [progress, setProgress] = useState<number | null>(0);

  const customFont = theme.customFont;
  const specimenFamily = customFont ? customFontFamily(customFont.key) : null;

  const fontDescriptions: Partial<Record<StorefrontFont, string>> = {
    sans: t("fontDescDefault"),
    inter: t("fontDescInter"),
    montserrat: t("fontDescMontserrat"),
  };

  const options: SelectOption<StorefrontFont>[] = STOREFRONT_FONTS.filter(
    // Offered only once there is something to point at.
    (font) => font !== "custom" || customFont !== undefined,
  ).map((font) => ({
    value: font,
    label:
      font === "custom" && customFont
        ? customFont.name
        : tRoot(FONT_LABELS[font]),
    description:
      font === "custom" ? t("uploadedFontDesc") : fontDescriptions[font],
  }));

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      // Type/size are checked inside uploadToR2 before any network call, so
      // every failure arrives as a structured UploadError with a reason.
      // The sample storefront never uploads: the seller's own copy stands in.
      const key = sample
        ? sampleObjectKey("fonts", file)
        : await uploadToR2(file, "font", setProgress);
      onChange({
        ...withoutPairing(theme),
        customFont: { key, name: file.name.slice(0, CUSTOM_FONT_NAME_MAX) },
        // Uploading a font is the act of choosing it; leaving the storefront on
        // its old face (or a pairing, which would win over it) would make the
        // upload look like it did nothing.
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
      showActionError(info);
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

  const pairing = isFontPairing(theme.fontPairing) ? theme.fontPairing : undefined;
  const pairingFaces = pairing ? fontPairingPresentation(pairing) : undefined;

  return (
    <div className="space-y-4">
      <FontPairingPicker
        value={pairing}
        onChange={(fontPairing) => onChange({ ...theme, fontPairing })}
      />

      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className={labelClass}>{t("ownFont")}</span>
          <InfoTip label={t("fontInfoLabel")}>
            {t("fontInfoBody")}
          </InfoTip>
        </span>
        {/* Out of the AT tree: the visible button below is the labelled
            affordance and clicks this programmatically. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={FONT_ACCEPT}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
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
              ? t("processing")
              : t("uploadingPct", { n: Math.round(progress * 100) })
            : customFont
              ? t("replaceFont")
              : t("uploadFont")}
        </button>
        {uploading && <ProgressBar value={progress} label={t("uploadingLabel")} />}

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
                {tRoot("Common.actions.remove")}
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

      <MoreDisclosure>
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-font`} className={labelClass}>
            {tType("singleFont")}
          </label>
          <Select
            id={`${fieldId}-font`}
            value={theme.font}
            options={options}
            // A pairing wins over the single font, so choosing one here is
            // choosing it INSTEAD of the pairing.
            onChange={(font) => onChange({ ...withoutPairing(theme), font })}
          />
          {pairing && <p className={infoTextClass}>{tType("singleFontHint")}</p>}
        </div>

        <TextStylesEditor
          theme={theme}
          onChange={onChange}
          faceClassName={pairingFaces?.className}
          faceStyle={pairingFaces?.style}
        />
      </MoreDisclosure>
    </div>
  );
}

/**
 * The five font pairings, each named in its own headline face over a line in
 * its body face: the sample IS the choice. The faces are declared on each
 * row (their variable classes), so the samples render in the real fonts
 * wherever this panel sits, and a browser fetches a face's file only once a
 * sample in it is on screen.
 */
function FontPairingPicker({
  value,
  onChange,
}: {
  value: FontPairing | undefined;
  onChange: (pairing: FontPairing) => void;
}) {
  const tKey = useTranslations();
  const t = useTranslations("EditorType.panel.pairings");
  return (
    <div className="space-y-1.5">
      <span className={labelClass}>{t("title")}</span>
      <div role="group" aria-label={t("group")} className="space-y-1.5">
        {FONT_PAIRINGS.map((pairing) => {
          const active = pairing === value;
          const faces = fontPairingPresentation(pairing);
          const labels = FONT_PAIRING_LABELS[pairing];
          return (
            <button
              key={pairing}
              type="button"
              onClick={() => onChange(pairing)}
              aria-pressed={active}
              data-font-pairing={pairing}
              className={cn(
                "flex w-full flex-col items-start rounded-none border px-2.5 py-2 text-left transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                active ? "border-foreground bg-accent" : "border-border hover:bg-accent/50",
                faces.className,
              )}
              style={faces.style}
            >
              <span className="block text-lg leading-tight text-foreground" style={fontRoleStyle("heading")}>
                {tKey(labels.name)}
              </span>
              <span className="block text-xs leading-tight text-muted-foreground" style={fontRoleStyle("body")}>
                {tKey(labels.hint)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
