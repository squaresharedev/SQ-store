"use client";

import { useRef, useState } from "react";
import { ImageOff, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import {
  focusRingClass,
  helpTextClass,
  transitionClass,
} from "@/components/ui/control-styles";

/** One distinct piece of artwork already uploaded to this storefront. */
export type StorefrontUpload = {
  /** R2 object key — the identity. Two blocks showing the same picture share
   *  one key, and appear here once. */
  key: string;
  /** Signed display URL, or null when it could not be resolved. */
  url: string | null;
  /** The alt text of the first block using it, as a label. */
  alt: string;
};

/**
 * The upload half of the left-hand library: put your own artwork on the
 * canvas, and re-use what you already uploaded.
 *
 * WHY RE-USE MATTERS ENOUGH TO BUILD. An element block stores an R2 object
 * KEY, so placing the same logo in two corners is two blocks pointing at one
 * object — no second upload, no second 2 MB for the buyer to fetch, and the
 * save path's eviction already understands it (a key still referenced by any
 * block is never evicted). Without this panel the only way to place a logo
 * twice was to upload it twice.
 *
 * THE FILE ITSELF NEVER GOES ANYWHERE FROM HERE. This component hands the
 * File to the designer, which owns the upload, the toasts and the failure
 * paths — the same call the toolbar's Upload button makes.
 */
export function UploadsPanel({
  uploads,
  uploading,
  progress,
  canAddBlocks,
  onUpload,
  onPlace,
}: {
  uploads: readonly StorefrontUpload[];
  uploading: boolean;
  /** 0..1 while bytes move, null once the server takes over. */
  progress: number | null;
  /** False at the block cap: nothing new can land on the canvas. */
  canAddBlocks: boolean;
  onUpload: (file: File) => void;
  /** Place another block using artwork already uploaded. */
  onPlace: (upload: StorefrontUpload) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Drag-over state, counted rather than boolean: dragging across a child
  // fires leave-then-enter, and a plain flag flickers the highlight off.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  const busy = uploading || !canAddBlocks;

  function take(files: FileList | null) {
    const file = files?.[0];
    if (file && !busy) onUpload(file);
  }

  return (
    <div>
      <CollapsibleSection title="Add an image">
        {/* Click OR drop. The drop target is the same surface as the button so
            there is nothing to aim at that is not also the thing you press. */}
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragDepth((depth) => depth + 1);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
          onDrop={(event) => {
            event.preventDefault();
            setDragDepth(0);
            take(event.dataTransfer.files);
          }}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-border px-3 py-6",
              "text-muted-foreground hover:border-foreground hover:bg-accent hover:text-foreground",
              "disabled:pointer-events-none disabled:opacity-50",
              dragging && "border-foreground bg-accent text-foreground",
              transitionClass,
              focusRingClass,
            )}
          >
            <Upload className="size-5" strokeWidth={2} aria-hidden="true" />
            <span className="text-xs font-medium">
              {uploading
                ? progress === null
                  ? "Processing…"
                  : `Uploading… ${Math.round(progress * 100)}%`
                : dragging
                  ? "Drop to upload"
                  : "Upload image"}
            </span>
          </button>
        </div>

        <p className={cn(helpTextClass, "mt-2")}>
          {canAddBlocks
            ? "SVG, PNG, JPEG, WebP, GIF or AVIF. Up to 2 MB. Drop a file here or press to browse."
            : "The canvas is full. Remove a block to add another."}
        </p>

        {/* PLT-02: aria-hidden removes this from the AT tree. The visible
            "Upload image" button is the labeled affordance; the input is an
            implementation detail that the button programmatically clicks. */}
        <input
          ref={inputRef}
          type="file"
          accept={ELEMENT_ACCEPT}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const { files } = event.target;
            // Clear first: picking the SAME file twice fires no `change` at
            // all unless the value is reset, so a retry after a failed upload
            // would silently do nothing.
            const picked = files?.[0] ?? null;
            event.target.value = "";
            if (picked && !busy) onUpload(picked);
          }}
        />
      </CollapsibleSection>

      <CollapsibleSection title="In this storefront">
        {uploads.length > 0 ? (
          <div
            role="group"
            aria-label="Images in this storefront"
            className="grid grid-cols-3 gap-1.5"
          >
            {uploads.map((upload) => (
              <button
                key={upload.key}
                type="button"
                onClick={() => onPlace(upload)}
                disabled={!canAddBlocks}
                title={upload.alt || "Place this image again"}
                aria-label={
                  upload.alt
                    ? `Place ${upload.alt} again`
                    : "Place this image again"
                }
                className={cn(
                  "flex aspect-square items-center justify-center overflow-hidden rounded-sm border border-border bg-card p-1",
                  "hover:border-foreground hover:bg-accent",
                  "disabled:pointer-events-none disabled:opacity-50",
                  transitionClass,
                  focusRingClass,
                )}
              >
                {upload.url ? (
                  // Contain, not cover: this is a chooser, so the whole
                  // picture matters more than filling the square.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={upload.url}
                    alt=""
                    className="size-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <ImageOff
                    className="size-4 text-muted-foreground"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className={helpTextClass}>
            Images you upload collect here, so you can place the same one
            again without uploading it twice.
          </p>
        )}
      </CollapsibleSection>
    </div>
  );
}

/**
 * What the file dialog offers. Extensions alongside the MIME types because
 * browsers report SVG inconsistently — a filter of `image/svg+xml` alone can
 * grey out the very .svg the seller is trying to pick.
 */
const ELEMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,.svg";
