"use client";

import * as React from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ImageUpIcon } from "@/components/ui/ImageUpIcon";
import { cn } from "@/lib/utils";
import {
  focusRingClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";

/**
 * Pan/zoom crop surface for a profile photo, ported from the SquareShare app
 * (`App/src/components/ProfilePage.tsx`) onto this repo's Modal and tokens.
 *
 * The whole thing is a CSS transform over a cover-fitted <img>, plus a canvas
 * that inverts that transform on save, with no cropping library. Output is a
 * circle-clipped 512x512 WebP handed back as a File, because this repo uploads
 * through a server action (magic-byte sniff + rate limit) rather than a
 * presigned PUT, and a File is what that action wants.
 *
 * The transform is `translate(x, y) scale(zoom)` about the centre, so the
 * inverse for a viewport point sx is `(sx - half - x) / zoom + half`. Do not
 * re-derive it; the save path below depends on that exact form.
 */

const DEFAULT_SIZE = 280;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const OUTPUT_SIZE = 512;
/** One arrow-key press, in surface pixels. Shift multiplies it. */
const NUDGE = 8;

type View = { zoom: number; x: number; y: number };

const clampTo = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/** The furthest the image may be panned before the circle would show through
 *  to the background: half the overhang the zoom created, on each axis. */
const maxOffset = (zoom: number, size: number) => ((zoom - 1) * size) / 2;

export function ProfilePicCropModal({
  open,
  src,
  onSave,
  onClose,
  onUploadNew,
}: {
  open: boolean;
  /** Data URL of a freshly picked file, or the URL of the current avatar. */
  src: string;
  onSave: (file: File) => void;
  onClose: () => void;
  onUploadNew: () => void;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const dragging = React.useRef(false);
  const dragStart = React.useRef({ x: 0, y: 0, offX: 0, offY: 0 });

  const [view, setView] = React.useState<View>({ zoom: 1, x: 0, y: 0 });
  const [natural, setNatural] = React.useState({ w: 0, h: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [grabbing, setGrabbing] = React.useState(false);

  // The surface is 280px where there is room and shrinks on a narrow phone, so
  // every number below is measured rather than assumed: the crop maths is in
  // surface pixels and a hardcoded 280 would silently skew the output.
  // sizeRef mirrors it for the callbacks below, which must not re-create
  // themselves on every resize; the observer keeps the two in step.
  const [size, setSize] = React.useState(DEFAULT_SIZE);
  const sizeRef = React.useRef(DEFAULT_SIZE);

  // `mask="url(#id)"` needs a plain fragment name; useId's colons are legal in
  // HTML but not worth betting the overlay on.
  const maskId = `crop-mask-${React.useId().replace(/:/g, "")}`;

  /** Re-clamps on every change, so zooming out while panned to an edge pulls
   *  the image back instead of exposing background inside the circle. */
  const setZoom = React.useCallback(
    (next: number | ((current: number) => number)) => {
      setView((v) => {
        const raw = typeof next === "function" ? next(v.zoom) : next;
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, raw));
        const m = maxOffset(zoom, sizeRef.current);
        return { zoom, x: clampTo(v.x, m), y: clampTo(v.y, m) };
      });
    },
    [],
  );

  const pan = React.useCallback((x: number, y: number) => {
    setView((v) => {
      const m = maxOffset(v.zoom, sizeRef.current);
      return { ...v, x: clampTo(x, m), y: clampTo(y, m) };
    });
  }, []);

  // Load the source through a CORS-enabled request. Without crossOrigin, an
  // avatar already served from Storage taints the canvas and toBlob throws;
  // the visible <img> carries the same attribute so both share one cache entry
  // and the second load cannot come back header-less.
  React.useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setView({ zoom: 1, x: 0, y: 0 });
      setError(null);
    };
    img.onerror = () => {
      if (cancelled) return;
      setError("That image could not be loaded. Try choosing it again.");
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [open, src]);

  // Measure the surface and keep the offsets valid if it resizes under us.
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) {
        setSize(width);
        sizeRef.current = width;
        setView((v) => {
          const m = maxOffset(v.zoom, width);
          return { ...v, x: clampTo(v.x, m), y: clampTo(v.y, m) };
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // Wheel is attached natively: React registers its own wheel listener as
  // passive, so preventDefault() from an onWheel prop is ignored and the page
  // scrolls behind the modal while you try to zoom.
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((z) => z - event.deltaY * 0.003);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, setZoom]);

  function handlePointerDown(event: React.PointerEvent) {
    if (!imgRef.current) return;
    event.preventDefault();
    dragging.current = true;
    setGrabbing(true);
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      offX: view.x,
      offY: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!dragging.current) return;
    pan(
      dragStart.current.offX + (event.clientX - dragStart.current.x),
      dragStart.current.offY + (event.clientY - dragStart.current.y),
    );
  }

  function handlePointerUp() {
    dragging.current = false;
    setGrabbing(false);
  }

  // Keyboard panning, so the crop is reachable without a pointer. The zoom
  // slider already handles the other axis of the interaction.
  function handleKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? NUDGE * 4 : NUDGE;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pan(view.x + move[0], view.y + move[1]);
  }

  function handleSave() {
    const img = imgRef.current;
    if (!img || !natural.w || !natural.h || saving) return;
    setSaving(true);

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setSaving(false);
      setError("Your browser could not process that image.");
      return;
    }

    // What object-fit:cover renders at zoom 1: the short edge fills the box.
    const aspect = natural.w / natural.h;
    const coverW = aspect >= 1 ? size * aspect : size;
    const coverH = aspect >= 1 ? size : size / aspect;

    // Invert translate(x, y) scale(zoom) about the centre to find the visible
    // rect in surface coordinates, then map it into natural image pixels.
    const half = size / 2;
    const visibleX = (0 - half - view.x) / view.zoom + half;
    const visibleY = (0 - half - view.y) / view.zoom + half;
    const visibleSize = size / view.zoom;

    const imgLeft = (size - coverW) / 2;
    const imgTop = (size - coverH) / 2;

    const sx = ((visibleX - imgLeft) / coverW) * natural.w;
    const sy = ((visibleY - imgTop) / coverH) * natural.h;
    const sw = (visibleSize / coverW) * natural.w;
    const sh = (visibleSize / coverH) * natural.h;

    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setSaving(false);
            setError("Could not prepare that image. Try a different one.");
            return;
          }
          // A browser without WebP encoding silently hands back a PNG, so the
          // name follows the blob rather than the request. The server sniffs
          // the bytes either way and both types are on its allowlist.
          const ext = blob.type === "image/png" ? "png" : "webp";
          onSave(new File([blob], `avatar.${ext}`, { type: blob.type }));
        },
        "image/webp",
        0.9,
      );
    } catch {
      // SecurityError: the canvas was tainted, i.e. the source loaded without
      // usable CORS headers. Nothing the user can fix except re-picking a file.
      setSaving(false);
      setError("That image could not be exported. Upload it again instead.");
    }
  }

  const ready = natural.w > 0 && !error;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Crop your photo"
      description="Drag to reposition. Scroll or use the slider to zoom."
    >
      <div className="flex flex-col items-center gap-5">
        <div
          ref={boxRef}
          role="application"
          aria-label="Crop area. Drag or use the arrow keys to reposition."
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          className={cn(
            "relative aspect-square w-full max-w-[280px] touch-none select-none overflow-hidden rounded-lg bg-black",
            focusRingClass,
            ready && (grabbing ? "cursor-grabbing" : "cursor-grab"),
          )}
        >
          {ready && (
            /* eslint-disable-next-line @next/next/no-img-element -- a data URL or public Storage URL under a live CSS transform; next/image adds nothing. */
            <img
              src={src}
              alt=""
              crossOrigin="anonymous"
              draggable={false}
              className="pointer-events-none absolute inset-0 size-full object-cover"
              style={{
                transformOrigin: "center center",
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              }}
            />
          )}

          {/* Dims everything the circle will discard, so what you see inside
              the ring is exactly what gets saved. */}
          <svg
            className="pointer-events-none absolute inset-0 size-full"
            aria-hidden
          >
            <defs>
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                <circle cx="50%" cy="50%" r="49%" fill="black" />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.6)"
              mask={`url(#${maskId})`}
            />
            <circle
              cx="50%"
              cy="50%"
              r="49%"
              fill="none"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="2"
            />
          </svg>
        </div>

        <div className="flex w-full max-w-[280px] items-center gap-3">
          <ZoomOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            disabled={!ready}
            aria-label="Zoom"
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className={cn(
              "h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-foreground disabled:opacity-50",
              focusRingClass,
            )}
          />
          <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>

        {error && (
          <p role="alert" className="font-inter text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onUploadNew}
            suppressHydrationWarning
            className={secondaryButtonClass}
          >
            <ImageUpIcon className="size-4" />
            Choose another
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!ready || saving}
            suppressHydrationWarning
            className={primaryButtonClass}
          >
            {saving ? "Saving…" : "Save photo"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
