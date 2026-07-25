"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import {
  BACKGROUND_IMAGE_SCALE_MAX,
  BACKGROUND_IMAGE_SCALE_MIN,
  DEFAULT_BACKGROUND_IMAGE_PLACEMENT,
  type StorefrontBackground,
} from "@/types/storefront";
import { unexpectedError, type ActionError } from "@/lib/errors";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { cn } from "@/lib/utils";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Slider } from "@/components/ui/slider";
import {
  infoTextClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { resolveBackgroundStyle } from "./background-presets";

type Kind = StorefrontBackground["kind"];

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: "solid", label: "Color" },
  { value: "gradient", label: "Gradient" },
  { value: "image", label: "Image" },
];

// Data default for the config's second gradient stop (configs store raw hex
// by design) — matches the design system's neutral-200.
const DEFAULT_GRADIENT_TO = "#e5e5e5";

/** A base color to carry across type switches. */
function baseColor(background: StorefrontBackground): string {
  switch (background.kind) {
    case "gradient":
      return background.from;
    case "image":
      return "#ffffff";
    default:
      return background.color;
  }
}

function switchKind(
  kind: Exclude<Kind, "image">,
  current: StorefrontBackground,
): StorefrontBackground {
  if (kind === current.kind) return current;
  const base = baseColor(current);
  return kind === "solid"
    ? { kind: "solid", color: base }
    : { kind: "gradient", from: base, to: DEFAULT_GRADIENT_TO, angle: 160 };
}

/**
 * Background control: choose a solid color, build a custom two-stop gradient,
 * or upload an image (10 MB cap; drag the preview to position it, zoom to
 * resize). Emits only the structured, schema-safe StorefrontBackground
 * shapes; the image variant stores the R2 object KEY, and display URLs come
 * from the caller.
 */
export function BackgroundEditor({
  value,
  onChange,
  imageUrl,
  onImageChange,
}: {
  value: StorefrontBackground;
  onChange: (background: StorefrontBackground) => void;
  /** Display URL for the stored image background (signed or object URL). */
  imageUrl: string | null;
  /** Reports a new local preview URL after an upload (null on remove). */
  onImageChange: (url: string | null) => void;
}) {
  // "Image" tab can be open before any upload exists; the stored background
  // only becomes {kind:"image"} once an upload succeeds.
  const [imageTab, setImageTab] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ActionError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag-to-position bookkeeping: pointer + position at drag start.
  const panStart = useRef<{
    pointerX: number;
    pointerY: number;
    x: number;
    y: number;
  } | null>(null);

  const activeKind: Kind | "image-pending" =
    value.kind === "image" ? "image" : imageTab ? "image-pending" : value.kind;

  function selectKind(kind: Kind) {
    if (kind === "image") {
      setImageTab(true);
      return;
    }
    setImageTab(false);
    if (value.kind === "image") {
      // Leaving an image background: the old object is evicted server-side
      // on the next save; the preview URL is no longer needed.
      onImageChange(null);
    }
    onChange(switchKind(kind, value));
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      // Type/size are validated inside uploadToR2 (before any network call),
      // so every failure arrives as a structured UploadError with a reason.
      const key = await uploadToR2(file, "image");
      onChange({ kind: "image", key, ...DEFAULT_BACKGROUND_IMAGE_PLACEMENT });
      onImageChange(URL.createObjectURL(file));
    } catch (error) {
      setUploadError(
        error instanceof UploadError
          ? error.info
          : unexpectedError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    if (value.kind !== "image") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: value.x,
      y: value.y,
    };
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const start = panStart.current;
    if (!start || value.kind !== "image") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Dragging right reveals more of the image's left side, so position %
    // moves opposite to the pointer.
    const x = Math.round(
      Math.min(
        100,
        Math.max(0, start.x - ((event.clientX - start.pointerX) / rect.width) * 100),
      ),
    );
    const y = Math.round(
      Math.min(
        100,
        Math.max(0, start.y - ((event.clientY - start.pointerY) / rect.height) * 100),
      ),
    );
    if (x !== value.x || y !== value.y) onChange({ ...value, x, y });
  }

  function endPan() {
    panStart.current = null;
  }

  return (
    <div className="space-y-3">
      <span className={labelClass}>Background</span>

      <div role="group" aria-label="Background type" className="flex">
        {KINDS.map((kind, index) => {
          const active =
            kind.value === "image"
              ? activeKind === "image" || activeKind === "image-pending"
              : activeKind === kind.value;
          return (
            <button
              key={kind.value}
              type="button"
              onClick={() => selectKind(kind.value)}
              aria-pressed={active}
              className={cn(
                "flex-1 border border-border px-3 py-1.5 font-inter text-xs font-medium",
                "transition-colors duration-180 ease-in-out motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                index > 0 && "-ml-px",
                active
                  ? "z-10 bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {kind.label}
            </button>
          );
        })}
      </div>

      {(activeKind === "image" || activeKind === "image-pending") && (
        <div className="space-y-3">
          {value.kind === "image" && imageUrl && (
            <div className="space-y-1.5">
              <span className={labelClass}>Position</span>
              {/* Drag the image inside the frame to choose what shows. */}
              <div
                role="application"
                aria-label="Drag to position the background image"
                onPointerDown={startPan}
                onPointerMove={movePan}
                onPointerUp={endPan}
                onPointerCancel={endPan}
                style={resolveBackgroundStyle(value, imageUrl)}
                className="h-28 w-full cursor-move touch-none rounded-sm border border-border"
              />
              <p className={infoTextClass}>
                Drag the preview to reposition. Zoom to resize.
              </p>
              <div className="flex items-center justify-between">
                <span className={labelClass}>Zoom</span>
                <span className={infoTextClass}>{value.scale}%</span>
              </div>
              <Slider
                min={BACKGROUND_IMAGE_SCALE_MIN}
                max={BACKGROUND_IMAGE_SCALE_MAX}
                step={5}
                value={value.scale}
                onChange={(scale) => onChange({ ...value, scale })}
                ariaLabel="Background image zoom"
                valueText={`${value.scale} percent`}
              />
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            className="sr-only"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={secondaryButtonClass + " w-full"}
          >
            <ImagePlus className="size-4" strokeWidth={2} aria-hidden="true" />
            {uploading
              ? "Uploading…"
              : value.kind === "image"
                ? "Replace image"
                : "Upload image"}
          </button>
          <p className={infoTextClass}>Up to 10 MB. JPEG, PNG, WebP, GIF, or AVIF.</p>
          {uploadError && (
            <ActionErrorNotice error={uploadError} variant="inline" />
          )}
        </div>
      )}

      {value.kind === "solid" && (
        <ColorPicker
          id="bg-solid"
          label="Color"
          value={value.color}
          onChange={(color) => onChange({ kind: "solid", color })}
        />
      )}

      {value.kind === "gradient" && (
        <div className="space-y-3">
          <ColorPicker
            id="bg-grad-from"
            label="From"
            value={value.from}
            onChange={(from) => onChange({ ...value, from })}
          />
          <ColorPicker
            id="bg-grad-to"
            label="To"
            value={value.to}
            onChange={(to) => onChange({ ...value, to })}
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className={labelClass}>Angle</span>
              <span className="font-inter text-sm text-muted-foreground">
                {value.angle}°
              </span>
            </div>
            <Slider
              min={0}
              max={360}
              step={5}
              value={value.angle}
              onChange={(angle) => onChange({ ...value, angle })}
              ariaLabel="Gradient angle"
              valueText={`${value.angle} degrees`}
            />
          </div>
        </div>
      )}

    </div>
  );
}
