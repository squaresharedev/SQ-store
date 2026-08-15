"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  IMAGE_SCALE_MAX,
  IMAGE_SCALE_MIN,
  clampPlacement,
  panPlacement,
  zoomPlacement,
  zoomPlacementTo,
  type ImagePlacement,
} from "@/lib/images/placement";

/**
 * The surface you drag when a product tile is being framed.
 *
 * It sits ON the tile, covering it exactly, and it OWNS every gesture that
 * lands on it: a pointerdown here never reaches the grid cell underneath, so
 * dragging moves the picture instead of the block, and arrow keys nudge the
 * picture instead of resizing the tile. That single `stopPropagation` is what
 * lets frame mode coexist with a canvas that otherwise treats any press on a
 * tile as the start of a drag.
 *
 * It renders nothing visible but the cursor and a hint: the picture it is
 * moving is the tile's own `<img>`, one layer below.
 */

/**
 * The rest of the picture, shown around the tile while framing.
 *
 * Cropping blind is the thing that makes a crop tool frustrating: you can see
 * what you kept but not what you are throwing away, so you drag by trial and
 * error. This draws the WHOLE image at exactly the position and size the tile
 * is cropping it to, dimmed, so the frame reads as a window onto a picture
 * that carries on past it.
 *
 * It renders BEFORE the tile's face in the DOM and therefore paints beneath
 * it — which is what leaves the part inside the frame at full strength with
 * no masking, no second copy, and no hole to keep in register.
 *
 * The geometry inverts the CSS in `imageStyle`. `object-fit: cover` renders
 * the picture at `cover` scale; `object-position` offsets it across its
 * overhang; the transform then scales about that same point. Composing those
 * gives a plain rect:
 *
 *     width  = cover * scale                left = (x/100) * (frame - width)
 *
 * which is exact, so the dimmed picture lines up with the bright one to the
 * pixel at any zoom.
 */
export function TileImageGhost({
  src,
  placement,
}: {
  src: string;
  placement: ImagePlacement;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const measure = useCallback(() => {
    const host = hostRef.current;
    const image = imageRef.current;
    if (!host || !image) return;
    const { width, height } = host.getBoundingClientRect();
    const natural = { w: image.naturalWidth, h: image.naturalHeight };
    // Nothing to draw until both the frame and the picture have a size — and
    // a zero would divide its way into an Infinity here.
    if (!width || !height || !natural.w || !natural.h) {
      setRect(null);
      return;
    }
    const cover = Math.max(width / natural.w, height / natural.h);
    const zoom = placement.scale / 100;
    const rendered = {
      width: natural.w * cover * zoom,
      height: natural.h * cover * zoom,
    };
    setRect({
      left: (placement.x / 100) * (width - rendered.width),
      top: (placement.y / 100) * (height - rendered.height),
      ...rendered,
    });
  }, [placement.x, placement.y, placement.scale]);

  // Layout effect, so the dimmed copy never paints a frame behind the bright
  // one during a drag.
  useLayoutEffect(measure, [measure]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-testid="tile-image-ghost"
      // No overflow clipping here: spilling past the tile IS the feature.
      className="pointer-events-none absolute inset-0"
    >
      <img
        ref={imageRef}
        src={src}
        alt=""
        draggable={false}
        // The image is remeasured when it loads, which is also the first time
        // its natural size exists.
        onLoad={measure}
        // max-w-none: the base layer caps images at their container, which
        // would silently shrink the very overflow being drawn.
        className="absolute max-w-none opacity-90"
        style={
          rect
            ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            : { opacity: 0 }
        }
      />
      {/* A real scrim, not just a lower opacity on the picture. Fading alone
          moves the image TOWARDS the surface behind it — on this board, which
          is usually pale, that reads as washed out rather than as "outside
          the frame". A black wash darkens it whatever the storefront's
          background happens to be. */}
      {rect && (
        <div
          className="absolute bg-black/45"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}
    </div>
  );
}

/** Wheel notches and +/- keys move the zoom by this much. */
const ZOOM_STEP = 8;
/** Arrow keys nudge by a percent of the picture; Shift takes bigger strides. */
const NUDGE = 2;
const NUDGE_LARGE = 10;

/** jsdom reports every box as 0x0, and a frame with no size can never pan.
 *  Falling back keeps the component testable without a layout engine. */
const FALLBACK_FRAME = 240;

type Pointer = { x: number; y: number };

export function TileImageFramer({
  placement,
  imageRef,
  label,
  onChange,
  onExit,
}: {
  placement: ImagePlacement;
  /** The picture being framed, for its intrinsic size. */
  imageRef: RefObject<HTMLImageElement | null>;
  /** Product title, so the surface announces WHICH image it is framing. */
  label: string;
  /** Called on every step of a gesture; the caller coalesces undo history. */
  onChange: (next: ImagePlacement) => void;
  onExit: () => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  // The live placement and callback, readable from the non-passive wheel
  // listener (which must not be re-registered on every render) and from
  // pointer handlers that would otherwise close over a stale value mid-drag.
  // Synced in an effect, never during render, per this codebase's pattern for
  // handler refs — and `apply` below also writes at event time, so a burst of
  // wheel notches compounds off its own result instead of the last paint.
  const current = useRef(placement);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    current.current = placement;
    onChangeRef.current = onChange;
  });

  /** Pointers currently down ON this surface, by id: one is a pan, two a pinch. */
  const pointers = useRef(new Map<number, Pointer>());
  /** Where the pan started, and the placement it started from. */
  const panFrom = useRef<{ pointer: Pointer; placement: ImagePlacement } | null>(
    null,
  );
  /** A press that never travelled is a click, which positions instead. */
  const travelled = useRef(false);
  /** True once a gesture has had two fingers on it. Lifting out of a pinch
   *  leaves one pointer down that never moved, which would otherwise read as
   *  a tap and yank the picture to centre the moment you finish zooming. */
  const pinched = useRef(false);
  /** Finger distance and scale when a pinch began. */
  const pinchFrom = useRef<{ distance: number; scale: number } | null>(null);

  /** The frame's box plus the picture's intrinsic size — everything the
   *  placement maths needs to make a drag track the pointer exactly. */
  const measure = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const image = imageRef.current;
    return {
      width: rect?.width || FALLBACK_FRAME,
      height: rect?.height || FALLBACK_FRAME,
      naturalWidth: image?.naturalWidth || undefined,
      naturalHeight: image?.naturalHeight || undefined,
    };
  }, [imageRef]);

  const apply = useCallback((next: ImagePlacement) => {
    if (
      next.x === current.current.x &&
      next.y === current.current.y &&
      next.scale === current.current.scale
    ) {
      return;
    }
    current.current = next;
    onChangeRef.current(next);
  }, []);

  // Wheel zoom. Registered natively and non-passively because React's own
  // wheel listener is passive: preventDefault there is ignored, and the canvas
  // behind would zoom the whole board while you tried to zoom one picture.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? 1 : -1;
      apply(zoomPlacement(current.current, direction * ZOOM_STEP));
    }
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, [apply]);

  // Focus lands here on entry, so the keyboard controls are live immediately
  // and a screen reader announces what this surface does.
  useEffect(() => {
    surfaceRef.current?.focus({ preventScroll: true });
  }, []);

  function distanceBetween(points: Pointer[]) {
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // THE line that makes frame mode possible: the grid cell below listens for
    // pointerdown to start dragging the block, and must never see this one.
    event.stopPropagation();
    event.preventDefault();

    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      // A second finger converts the gesture: stop panning, start pinching.
      panFrom.current = null;
      pinched.current = true;
      pinchFrom.current = {
        distance: distanceBetween(points),
        scale: current.current.scale,
      };
      return;
    }
    travelled.current = false;
    pinched.current = false;
    panFrom.current = {
      pointer: { x: event.clientX, y: event.clientY },
      placement: current.current,
    };
  }

  /**
   * A tap positions: whatever was under the finger moves to the middle of the
   * frame. With the rest of the picture visible around the tile, this is the
   * fastest way to say "that bit, there" — and on a phone it is far easier
   * than dragging a small tile accurately.
   */
  function centreOn(pointer: Pointer) {
    const surface = surfaceRef.current;
    if (!surface) return;
    const box = surface.getBoundingClientRect();
    if (!box.width || !box.height) return;
    apply(
      panPlacement(
        current.current,
        box.left + box.width / 2 - pointer.x,
        box.top + box.height / 2 - pointer.y,
        measure(),
      ),
    );
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    event.stopPropagation();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...pointers.current.values()];
    const pinch = pinchFrom.current;
    if (pinch && points.length >= 2) {
      const distance = distanceBetween(points);
      if (pinch.distance > 0) {
        apply(
          zoomPlacementTo(
            current.current,
            pinch.scale * (distance / pinch.distance),
          ),
        );
      }
      return;
    }

    const from = panFrom.current;
    if (!from) return;
    const dx = event.clientX - from.pointer.x;
    const dy = event.clientY - from.pointer.y;
    if (Math.hypot(dx, dy) > 4) travelled.current = true;
    apply(panPlacement(from.placement, dx, dy, measure()));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    // A press that went nowhere was a tap, not a drag — and never the tail of
    // a pinch, whose last finger is stationary by definition.
    if (
      pointers.current.size === 1 &&
      panFrom.current &&
      !travelled.current &&
      !pinched.current &&
      !pinchFrom.current
    ) {
      centreOn({ x: event.clientX, y: event.clientY });
    }
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
    if (pointers.current.size === 0) panFrom.current = null;
    else {
      // A finger lifted mid-pinch: re-anchor the remaining one so the picture
      // does not jump on the next move.
      const [remaining] = [...pointers.current.values()];
      panFrom.current = { pointer: remaining, placement: current.current };
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
    const frame = measure();
    // Nudges are expressed as a pointer delta so the keyboard travels the same
    // distance per press as a drag would, at any zoom.
    const nudge = (dx: number, dy: number) => {
      const span = { x: (frame.width * dx) / 100, y: (frame.height * dy) / 100 };
      apply(panPlacement(current.current, span.x, span.y, frame));
    };

    switch (event.key) {
      case "ArrowLeft":
        nudge(step, 0);
        break;
      case "ArrowRight":
        nudge(-step, 0);
        break;
      case "ArrowUp":
        nudge(0, step);
        break;
      case "ArrowDown":
        nudge(0, -step);
        break;
      case "+":
      case "=":
        apply(zoomPlacement(current.current, ZOOM_STEP));
        break;
      case "-":
      case "_":
        apply(zoomPlacement(current.current, -ZOOM_STEP));
        break;
      case "0":
        apply(clampPlacement(undefined));
        break;
      case "Escape":
      case "Enter":
        onExit();
        break;
      default:
        // Everything else (Tab, Ctrl+Z, …) belongs to the app.
        return;
    }
    // Handled keys must not reach the grid cell, which moves and resizes the
    // BLOCK on the very same arrows.
    event.preventDefault();
    event.stopPropagation();
  }

  const zoomed = Math.round(placement.scale);

  return (
    <div
      ref={surfaceRef}
      // application, not a plain group: every arrow key belongs to this
      // surface while it has focus, which is exactly what the role tells a
      // screen reader to expect.
      role="application"
      tabIndex={0}
      aria-label={`Framing the image for ${label}. Drag to reposition, arrow keys to nudge, plus and minus to zoom, Escape when done. Currently ${placement.x}% across, ${placement.y}% down, ${zoomed}% zoom.`}
      data-testid="tile-image-framer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      // Clicks must not reach the tile's select handler, or exiting by
      // clicking the picture would toggle the inspector shut.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      // The mode ring lives HERE, not on the tile: the dimmed picture spills
      // out of the tile and would paint straight over a ring drawn with the
      // tile's own border. On this surface it is above everything, and it
      // doubles as the edge of the frame against the dimmed surroundings.
      className="absolute inset-0 z-30 cursor-grab touch-none rounded-[inherit] outline-none ring-[3px] ring-inset ring-accent active:cursor-grabbing"
    >
      {/* The mode has to be legible without a manual. Bottom strip rather
          than a floating chip: it never covers the middle of the picture,
          which is the part being positioned. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-[inherit] bg-black/55 px-1.5 py-1 text-center font-inter text-[0.625rem] leading-tight text-white"
      >
        {zoomed > IMAGE_SCALE_MIN ? `${zoomed}% · ` : ""}
        Drag to frame · Esc
      </span>
    </div>
  );
}

export { IMAGE_SCALE_MAX, IMAGE_SCALE_MIN };
