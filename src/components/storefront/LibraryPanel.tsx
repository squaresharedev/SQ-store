"use client";

import { Library, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  focusRingClass,
  helpTextClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { PanelTabs, panelProps } from "@/components/ui/PanelTabs";
import type { ShapeKind } from "@/types/storefront";
import { ShapesPanel } from "./ShapesPanel";
import { UploadsPanel, type StorefrontUpload } from "./UploadsPanel";

/** The two halves of the library: your own artwork, or the built-in shapes. */
export const LIBRARY_TABS = ["uploads", "shapes"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

/**
 * "Things you can put on the canvas", as the left panel's second mode.
 *
 * It shares the slot with ColorPanel and mirrors its chrome — header, close
 * button, CollapsibleSection body — so the two read as one panel changing
 * contents rather than two panels fighting over an edge. The difference is
 * that this one names no target: a color panel closes itself when the block it
 * was editing disappears, whereas a library has nothing to lose, so it stays
 * until dismissed.
 *
 * The two halves are tabs rather than two more panel modes because they answer
 * the same question ("what do I add?") and a seller comparing their own logo
 * against a plain circle should not have to leave and re-enter to do it.
 */
export function LibraryPanel({
  tab,
  onTabChange,
  uploads,
  uploading,
  uploadProgress,
  canAddBlocks,
  onUpload,
  onPlaceUpload,
  onAddShape,
  onClose,
}: {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  uploads: readonly StorefrontUpload[];
  uploading: boolean;
  uploadProgress: number | null;
  canAddBlocks: boolean;
  onUpload: (file: File) => void;
  onPlaceUpload: (upload: StorefrontUpload) => void;
  onAddShape: (kind: ShapeKind) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Storefront.library");

  const tabOptions: readonly { value: LibraryTab; label: string }[] = useMemo(
    () => [
      { value: "uploads" as const, label: t("tabUploads") },
      { value: "shapes" as const, label: t("tabShapes") },
    ],
    [t],
  );

  return (
    <div>
      {/* Header: the same shape as ColorPanel's, deliberately. */}
      <div className="flex items-center justify-between gap-2 border-b border-border py-3 lg:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Library
            className="size-5 shrink-0 text-muted-foreground"
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {t("title")}
            </h2>
            <p className={helpTextClass}>
              {canAddBlocks ? t("hint") : t("canvasFull")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-none text-muted-foreground",
            "hover:bg-accent hover:text-foreground",
            transitionClass,
            focusRingClass,
          )}
        >
          <X className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <PanelTabs
        id="library"
        value={tab}
        options={tabOptions}
        onChange={onTabChange}
        ariaLabel={t("title")}
      />

      <div {...panelProps("library", tab)}>
        {tab === "uploads" ? (
          <UploadsPanel
            uploads={uploads}
            uploading={uploading}
            progress={uploadProgress}
            canAddBlocks={canAddBlocks}
            onUpload={onUpload}
            onPlace={onPlaceUpload}
          />
        ) : (
          <ShapesPanel onAddShape={onAddShape} canAddBlocks={canAddBlocks} />
        )}
      </div>
    </div>
  );
}
