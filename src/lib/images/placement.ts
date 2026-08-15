import type { CSSProperties } from "react";

/**
 * Where an image sits inside a frame that crops it.
 *
 * ONE model, two renderers. A storefront background and a product tile both
 * ask the same question — "which part of this picture do I want to see?" — and
 * before this they answered it with two copies of the same arithmetic. The
 * numbers live here; the CSS that expresses them differs per surface (see
 * `imageStyle` vs `backgroundStyle`) because a background-image and an
 * `<img object-fit:cover>` genuinely crop by different mechanisms.
 *
 * `x`/`y` are a FOCAL POINT in percent: the point of the image that lines up
 * with the same point of the frame. 50/50 is centred, 0/0 is the top-left
 * corner of the picture. `scale` is percent, where 100 means "exactly filling
 * the frame" — never smaller, so a frame can never show letterboxing.
 *
 * Percentages, not pixels, on purpose: they survive the tile being resized,
 * the board being zoomed, and the preview card rendering the same storefront
 * at a third of the size. They are also bounded ints, which is what the
 * storefront config contract allows.
 */
export type ImagePlacement = { x: number; y: number; scale: number };

export const DEFAULT_IMAGE_PLACEMENT: ImagePlacement = { x: 50, y: 50, scale: 100 };

/** 100 = the image exactly covers its frame. Below that it could not fill. */
export const IMAGE_SCALE_MIN = 100;
export const IMAGE_SCALE_MAX = 300;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Every route into a placement goes through here, so no caller can store a
 *  fractional percent or a scale that would letterbox the frame. */
export function clampPlacement(
  placement: Partial<ImagePlacement> | undefined,
): ImagePlacement {
  return {
    x: clamp(Math.round(placement?.x ?? DEFAULT_IMAGE_PLACEMENT.x), 0, 100),
    y: clamp(Math.round(placement?.y ?? DEFAULT_IMAGE_PLACEMENT.y), 0, 100),
    scale: clamp(
      Math.round(placement?.scale ?? DEFAULT_IMAGE_PLACEMENT.scale),
      IMAGE_SCALE_MIN,
      IMAGE_SCALE_MAX,
    ),
  };
}

/** True for a placement that changes nothing, so callers can drop the field
 *  entirely and leave untouched tiles indistinguishable from ones saved
 *  before framing existed. */
export function isDefaultPlacement(placement: ImagePlacement | undefined) {
  return (
    placement === undefined ||
    (placement.x === DEFAULT_IMAGE_PLACEMENT.x &&
      placement.y === DEFAULT_IMAGE_PLACEMENT.y &&
      placement.scale === DEFAULT_IMAGE_PLACEMENT.scale)
  );
}

/** The frame being dragged in, plus the picture's own size when it is known. */
export type PanFrame = {
  /** The frame's box, in CSS pixels. */
  width: number;
  height: number;
  /** The image's intrinsic size. Absent until it has loaded — see `travel`. */
  naturalWidth?: number;
  naturalHeight?: number;
  /**
   * How the surface crops, which decides how far a percentage travels.
   *
   * `cover` is an `<img object-fit:cover>` zoomed by a transform: the exact
   * model below, where a drag tracks the pointer.
   *
   * `frame` is the flat approximation the storefront background has always
   * used — one frame width spans the whole 0..100 range. Kept as its own mode
   * rather than "fixed", because a background crops through `background-size`
   * rather than a transform, so the cover model would be wrong for it AND
   * would change the feel of a surface that already shipped.
   */
  mode?: "cover" | "frame";
};

/**
 * How far the picture can travel along one axis, in frame pixels, per 100% of
 * placement change. This is the number that makes a drag feel 1:1, and it is
 * the sum of the TWO mechanisms that move an `<img object-fit:cover>`:
 *
 *   1. `object-position` slides the image across its cover OVERHANG — the part
 *      that cover scaled past the frame's edge. Multiplied by the transform,
 *      which magnifies that displacement along with everything else.
 *   2. `transform-origin` moves the pivot the zoom happens about. Shifting the
 *      pivot by d moves the content by d*(scale-1), in the same direction, so
 *      the two mechanisms compound rather than fight.
 *
 * Both terms are zero for a square image in a square frame at scale 100 — an
 * image that exactly fits has nothing to pan, which is correct, not a bug.
 * Callers must therefore tolerate a zero.
 */
function travel(
  frameSize: number,
  naturalSize: number | undefined,
  otherFrameSize: number,
  otherNaturalSize: number | undefined,
  scale: number,
  mode: "cover" | "frame",
): number {
  if (mode === "frame") return frameSize;
  const zoom = scale / 100;
  // Before the image reports its size there is no honest overhang to compute.
  // Falling back to the frame keeps dragging responsive rather than dead.
  if (!naturalSize || !otherNaturalSize) return frameSize * zoom;

  // `cover` scales the image by whichever factor makes BOTH axes reach.
  const cover = Math.max(
    frameSize / naturalSize,
    otherFrameSize / otherNaturalSize,
  );
  const overhang = Math.max(0, naturalSize * cover - frameSize);
  return overhang * zoom + frameSize * (zoom - 1);
}

/**
 * Move the picture by a pointer delta, in frame pixels.
 *
 * The percentage moves AGAINST the pointer: dragging right pulls the picture
 * right, which reveals more of its left side, which is a smaller x. Anyone who
 * has dragged a map expects exactly this.
 */
export function panPlacement(
  placement: ImagePlacement,
  dx: number,
  dy: number,
  frame: PanFrame,
): ImagePlacement {
  const mode = frame.mode ?? "cover";
  const travelX = travel(
    frame.width,
    frame.naturalWidth,
    frame.height,
    frame.naturalHeight,
    placement.scale,
    mode,
  );
  const travelY = travel(
    frame.height,
    frame.naturalHeight,
    frame.width,
    frame.naturalWidth,
    placement.scale,
    mode,
  );

  return clampPlacement({
    // A zero travel means the axis cannot move at all; dividing would be an
    // Infinity that clamps to an edge and makes the picture jump.
    x: travelX > 0 ? placement.x - (dx / travelX) * 100 : placement.x,
    y: travelY > 0 ? placement.y - (dy / travelY) * 100 : placement.y,
    scale: placement.scale,
  });
}

/** Zoom by a relative step (wheel notch, keypress). */
export function zoomPlacement(placement: ImagePlacement, delta: number) {
  return clampPlacement({ ...placement, scale: placement.scale + delta });
}

/** Zoom to an absolute scale (a pinch, which knows its own ratio). */
export function zoomPlacementTo(placement: ImagePlacement, scale: number) {
  return clampPlacement({ ...placement, scale });
}

/**
 * CSS for an `<img>` that already carries `object-fit: cover`.
 *
 * `transform-origin` MUST equal `object-position`. object-position puts the
 * picture's focal point at that point of the box; scaling about that same
 * point is what keeps it pinned while zooming. Any other origin and the
 * picture swims out from under the cursor as it grows.
 *
 * A default placement returns nothing at all, so a tile nobody has framed
 * carries no inline style and renders byte-identically to before this existed.
 */
export function imageStyle(
  placement: ImagePlacement | undefined,
): CSSProperties {
  if (isDefaultPlacement(placement) || !placement) return {};
  const origin = `${placement.x}% ${placement.y}%`;
  return {
    objectPosition: origin,
    ...(placement.scale !== 100
      ? { transform: `scale(${placement.scale / 100})`, transformOrigin: origin }
      : {}),
  };
}

/**
 * CSS for an element cropping the image as a BACKGROUND. Different mechanism,
 * same numbers: `background-size` does the zooming that a transform does for
 * an `<img>`, so there is no origin to keep in step.
 */
export function backgroundStyle(placement: ImagePlacement): CSSProperties {
  return {
    backgroundSize: `${placement.scale}% auto`,
    backgroundPosition: `${placement.x}% ${placement.y}%`,
    backgroundRepeat: "no-repeat",
  };
}
