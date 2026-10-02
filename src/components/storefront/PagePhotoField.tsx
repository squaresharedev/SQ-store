"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { unexpectedError } from "@/lib/errors";
import { IMAGE_CONTENT_TYPES } from "@/lib/validation/product";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { sampleObjectKey } from "@/lib/storefront/sample";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import { cssUrl } from "./background-presets";
import { cn } from "@/lib/utils";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { iconButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import type { PagePhoto } from "@/types/storefront";
import { PanelField } from "./PanelField";

/**
 * A hosted page's photo backdrop: add one, replace it, take it away. One field
 * for the product page's panel and the checkout's (which the thank-you page
 * shares), so the control is the same wherever a seller meets it.
 *
 * The upload is the one every image in the designer takes (uploadToR2: type
 * and size checked before a byte is sent, progress shown); the config keeps
 * only the object KEY, and the display URL is reported up (`onUrl`) so the
 * artboard can show the photo before it has been saved. The server re-checks
 * the key at save (lib/storefront/uploads.ts). The sample storefront never
 * uploads: the seller's own copy stands in, as in BackgroundEditor.
 */
export function PagePhotoField({
  photo,
  url,
  onChange,
  onUrl,
}: {
  /** What the page stores, or undefined for no photo. */
  photo: PagePhoto | undefined;
  /** The photo's display URL (signed at load, or local after an upload). */
  url: string | null;
  /** The new stored value; undefined removes the photo. */
  onChange: (photo: PagePhoto | undefined) => void;
  /** A display URL for a key just uploaded in this session. */
  onUrl: (key: string, url: string) => void;
}) {
  const t = useTranslations("Storefront");
  const showActionError = useActionErrorToast();
  const sample = useSampleMode();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // null once the bytes are sent and the server is still working: an
  // indeterminate bar rather than a stalled 100%.
  const [progress, setProgress] = useState<number | null>(0);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const key = sample ? sampleObjectKey("images", file) : await uploadToR2(file, "image", setProgress);
      onUrl(key, URL.createObjectURL(file));
      onChange({ key });
    } catch (error) {
      showActionError(
        error instanceof UploadError
          ? error.info
          : unexpectedError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const busyLabel =
    progress === null ? t("background.processing") : t("background.uploadingPct", { n: Math.round(progress * 100) });

  return (
    <PanelField
      label={t("pagePhoto.label")}
      info={{ label: t("pagePhoto.infoLabel"), content: t("pagePhoto.info") }}
    >
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_CONTENT_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label={t("pagePhoto.label")}
        onChange={(event) => handleFile(event.target.files?.[0])}
        data-page-photo-input=""
      />
      <div className="flex items-center gap-2" data-page-photo-field={photo ? "set" : "empty"}>
        {photo && (
          <span
            aria-hidden="true"
            className="size-10 shrink-0 rounded-sm border border-border bg-muted bg-cover bg-center"
            style={url ? { backgroundImage: cssUrl(url) } : undefined}
            data-page-photo-thumb=""
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
            {uploading ? busyLabel : photo ? t("background.replaceImage") : t("background.uploadImage")}
          </span>
        </button>
        {photo && !uploading && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className={iconButtonClass}
            aria-label={t("pagePhoto.remove")}
            title={t("pagePhoto.remove")}
          >
            <X className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
      {uploading && <ProgressBar value={progress} label={t("background.uploadingProgress")} />}
    </PanelField>
  );
}
