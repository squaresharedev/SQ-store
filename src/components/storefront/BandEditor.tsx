"use client";

import { useId, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { unexpectedError } from "@/lib/errors";
import { IMAGE_CONTENT_TYPES } from "@/lib/validation/product";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { sampleObjectKey } from "@/lib/storefront/sample";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import {
  backgroundOfKind,
  bandSwatches,
  gradientCss,
  paletteGradients,
  photoBackground,
} from "@/lib/storefront/bands";
import { cn } from "@/lib/utils";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { infoTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import {
  BAND_DIMS,
  type BandBackground,
  type BandDim,
  type StorefrontBand,
  type StorefrontTheme,
} from "@/types/storefront";
import { BlockActions } from "./BlockActions";
import { cssUrl } from "./background-presets";
import { PanelField, PanelGroup } from "./PanelField";
import { SwatchButton } from "./SwatchButton";

const BAND_KINDS = ["solid", "gradient", "image"] as const;

/**
 * A BAND'S OWN PANEL: its background, and nothing else (where it runs is set
 * by dragging it on the canvas). A colour from the palette, a ready-made
 * gradient built from the palette, or a photo with a shade over it so words
 * on it stay readable.
 *
 * Palette first: the swatches are the storefront's own colours, and any other
 * colour is behind the custom picker. A photo is uploaded the way every image
 * in the designer is (uploadToR2, an `images/` key; the save checks it again
 * on the server), and shows from the seller's own copy until the page is next
 * loaded with a signed one.
 */
export function BandEditor({
  band,
  theme,
  imageUrl,
  linked,
  onPaint,
  onPhotoUrl,
  onRemove,
}: {
  band: StorefrontBand;
  theme: StorefrontTheme;
  /** The band photo's display URL, if it has one. */
  imageUrl: string | null;
  /** A link leads to this band, so it cannot be taken away yet. */
  linked: boolean;
  onPaint: (background: BandBackground) => void;
  /** A display URL for a photo uploaded in this session, by its key. */
  onPhotoUrl: (key: string, url: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("EditorLayout.panel.band");
  const tStorefront = useTranslations("Storefront");
  const id = useId();
  const sample = useSampleMode();
  const showActionError = useActionErrorToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(0);
  const background = band.background;
  // Which kind the panel shows: the band's own, until the seller picks
  // "Photo" for a band that has none yet (nothing changes until it is chosen).
  const [shown, setShown] = useState<BandBackground["kind"]>(background.kind);
  const [prevKind, setPrevKind] = useState(background.kind);
  if (prevKind !== background.kind) {
    setPrevKind(background.kind);
    setShown(background.kind);
  }

  function pickKind(kind: BandBackground["kind"]) {
    setShown(kind);
    const next = backgroundOfKind(kind, background, theme);
    if (next && next !== background) onPaint(next);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const key = sample ? sampleObjectKey("images", file) : await uploadToR2(file, "image", setProgress);
      onPhotoUrl(key, URL.createObjectURL(file));
      // A replaced photo keeps its framing and its shade.
      onPaint(background.kind === "image" ? { ...background, key } : photoBackground(key));
    } catch (error) {
      showActionError(
        error instanceof UploadError ? error.info : unexpectedError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const swatches = bandSwatches(theme);
  const gradients = paletteGradients(theme);
  const busy =
    progress === null
      ? tStorefront("background.processing")
      : tStorefront("background.uploadingPct", { n: Math.round(progress * 100) });

  return (
    <div className="space-y-4" data-band-editor={band.id}>
      <PanelGroup title={t("background")}>
        <SegmentedControl
          value={shown}
          options={BAND_KINDS.map((kind) => ({ value: kind, label: t(`kind.${kind}`) }))}
          onChange={pickKind}
          ariaLabel={t("background")}
        />

        {shown === "solid" && background.kind === "solid" && (
          <PanelField label={t("palette")}>
            <div className="flex flex-wrap items-center gap-2">
              {swatches.map((hex) => (
                <SwatchButton
                  key={hex}
                  fill={{ backgroundColor: hex }}
                  label={hex}
                  active={background.color.toLowerCase() === hex}
                  onClick={() => onPaint({ kind: "solid", color: hex })}
                />
              ))}
              <ColorPicker
                compact
                label={t("custom")}
                value={background.color}
                onChange={(color) => onPaint({ kind: "solid", color })}
              />
            </div>
          </PanelField>
        )}

        {shown === "gradient" && (
          <PanelField label={t("gradients")}>
            <div className="flex flex-wrap items-center gap-2">
              {gradients.map((fill, index) => (
                <SwatchButton
                  key={gradientCss(fill)}
                  fill={{ backgroundImage: gradientCss(fill) }}
                  label={t("gradientOption", { n: index + 1 })}
                  active={background.kind === "gradient" && gradientCss(background) === gradientCss(fill)}
                  onClick={() => onPaint({ kind: "gradient", ...fill })}
                  wide
                />
              ))}
            </div>
          </PanelField>
        )}

        {shown === "image" && (
          <PanelField label={t("photo")}>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_CONTENT_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-label={t("photo")}
              onChange={(event) => void upload(event.target.files?.[0])}
              data-band-photo-input=""
            />
            <div className="flex items-center gap-2">
              {background.kind === "image" && (
                <span
                  aria-hidden="true"
                  className="size-10 shrink-0 rounded-sm border border-border bg-muted bg-cover bg-center"
                  style={imageUrl ? { backgroundImage: cssUrl(imageUrl) } : undefined}
                />
              )}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className={cn(secondaryButtonClass, "min-w-0 flex-1 justify-center gap-2")}
              >
                <ImagePlus className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="truncate">
                  {uploading
                    ? busy
                    : background.kind === "image"
                      ? tStorefront("background.replaceImage")
                      : tStorefront("background.uploadImage")}
                </span>
              </button>
            </div>
            {uploading && <ProgressBar value={progress} label={tStorefront("background.uploadingProgress")} />}
          </PanelField>
        )}

        {shown === "image" && background.kind === "image" && (
          <PanelField label={t("shade")} htmlFor={`${id}-shade`} info={{ label: t("shade"), content: t("shadeInfo") }}>
            <SegmentedControl
              id={`${id}-shade`}
              value={background.dim ?? "none"}
              options={BAND_DIMS.map((dim) => ({ value: dim, label: t(`dim.${dim}`) }))}
              onChange={(dim: BandDim) => {
                const { dim: _old, ...rest } = background;
                void _old;
                onPaint(dim === "none" ? rest : { ...rest, dim });
              }}
              ariaLabel={t("shade")}
            />
          </PanelField>
        )}
      </PanelGroup>

      <p className={infoTextClass}>{linked ? t("linked") : t("moveHint")}</p>
      <BlockActions onRemove={linked ? undefined : onRemove} removeLabel={t("remove")} />
    </div>
  );
}
