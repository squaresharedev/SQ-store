"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MoveDiagonal, MoveDiagonal2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
 * THE BOX THE PICTURE IS REALLY CROPPED TO, which is not the tile.
 *
 * A product tile with a `bar` title spends a row of its own column on that
 * band, so the photo's frame is shorter than the tile by exactly the band's
 * height. Measuring the tile instead — which both surfaces here used to do —
 * feeds a frame that is too tall into `cover`, and the dimmed copy of the rest
 * of the picture then renders several percent too big and no longer lines up
 * with the part inside the frame. The face marks its own frame with
 * `data-image-frame` (see ProductTileContent) so there is nothing to infer.
 *
 * A face that spends no row of its own — an uploaded element, whose picture IS
 * the whole tile — marks nothing, and the surface's own box is then the right
 * answer. That is the fallback, not an accident.
 */
function frameElement(from: HTMLElement | null): HTMLElement | null {
  if (!from) return null;
  const tile = from.closest("[data-block-tile]") ?? from.parentElement;
  return tile?.querySelector<HTMLElement>("[data-image-frame]") ?? null;
}

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
    const hostRect = host.getBoundingClientRect();
    // LAYOUT pixels, not screen ones. The numbers below are written straight
    // back as this element's own `left`/`width`, inside a canvas the designer
    // may have zoomed — measuring on screen and painting in CSS px would apply
    // that zoom twice. The host is `inset-0` on the tile, so its own two
    // measurements ARE the zoom factor.
    const zoomScale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
    const frame = frameElement(host)?.getBoundingClientRect() ?? hostRect;
    const width = frame.width / zoomScale;
    const height = frame.height / zoomScale;
    // Where that frame sits inside the tile: the band a `bar` title holds is
    // above or below the picture, so the dimmed copy has to start from the
    // picture's own top-left rather than the tile's.
    const origin = {
      x: (frame.x - hostRect.x) / zoomScale,
      y: (frame.y - hostRect.y) / zoomScale,
    };
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
      left: origin.x + (placement.x / 100) * (width - rendered.width),
      top: origin.y + (placement.y / 100) * (height - rendered.height),
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

/** Wheel notches, +/- keys and a tap on a corner move the zoom by this much. */
const ZOOM_STEP = 8;
/** Arrow keys nudge by a percent of the picture; Shift takes bigger strides. */
const NUDGE = 2;
const NUDGE_LARGE = 10;

/** jsdom reports every box as 0x0, and a frame with no size can never pan.
 *  Falling back keeps the component testable without a layout engine. */
const FALLBACK_FRAME = 240;

/** How far a corner has to travel before the gesture counts as a zoom rather
 *  than a tap, in pixels. Same spirit as the pan's own 4px threshold. */
const ZOOM_SLOP = 4;

/**
 * A corner handle's size and its distance from the two edges it hugs, as a
 * share of the tile's SHORTER side (cqmin), clamped at both ends.
 *
 * The same device the tile's own chip inset uses (see priceTagInsetStyle): a
 * board tile has no fixed size, so anything drawn on it in raw pixels is
 * either lost on a big tile or eats a small one. The floor keeps the handle
 * pressable on a phone; the ceiling stops it looking like a button on a tile
 * the size of a poster.
 */
const HANDLE_SIZE = "clamp(16px, 18cqmin, 28px)";
const HANDLE_INSET = "clamp(2px, 3cqmin, 6px)";

/**
 * The four corner handles, and the diagonal each one lies on.
 *
 * A picture that already fits its tile exactly has nothing to drag: panning is
 * dead by definition (there is no overhang to reveal), so the surface reads as
 * inert and the only ways out of it — a wheel, a pinch, the +/- keys — are
 * ones you have to already know about. A pair of arrows in each corner is the
 * affordance every crop tool has, and it says "this can get bigger" before
 * anything is touched.
 *
 * `edge` is which two sides each one hugs; the distance from them, and the
 * handle's own size, are container units (below) rather than a fixed number of
 * pixels. A tile on this canvas can be 90px or 500px, and four fixed 28px
 * discs on a 90px tile cover the picture they are there to reveal.
 */
const ZOOM_HANDLES = [
  { corner: "top left", edge: { top: HANDLE_INSET, left: HANDLE_INSET }, Icon: MoveDiagonal2 },
  { corner: "top right", edge: { top: HANDLE_INSET, right: HANDLE_INSET }, Icon: MoveDiagonal },
  { corner: "bottom left", edge: { bottom: HANDLE_INSET, left: HANDLE_INSET }, Icon: MoveDiagonal },
  { corner: "bottom right", edge: { bottom: HANDLE_INSET, right: HANDLE_INSET }, Icon: MoveDiagonal2 },
] as const;

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
  /** A corner handle being pulled: how far it started from the frame's centre,
   *  the scale it started at, and whether it has travelled far enough to be a
   *  drag rather than a tap. */
  const zoomFrom = useRef<{
    distance: number;
    scale: number;
    moved: boolean;
  } | null>(null);

  /**
   * The box the picture is cropped to, on screen.
   *
   * The surface covers the whole TILE — it has to, or a press on the title
   * band would reach the grid cell and drag the block — but the picture is
   * cropped by the frame inside it. Every gesture measures this, so a drag
   * tracks the pointer exactly on a tile whose title takes a row.
   */
  const frameRect = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    return (frameElement(surface) ?? surface).getBoundingClientRect();
  }, []);

  /** The frame's box plus the picture's intrinsic size — everything the
   *  placement maths needs to make a drag track the pointer exactly. */
  const measure = useCallback(() => {
    const rect = frameRect();
    const image = imageRef.current;
    return {
      width: rect?.width || FALLBACK_FRAME,
      height: rect?.height || FALLBACK_FRAME,
      naturalWidth: image?.naturalWidth || undefined,
      naturalHeight: image?.naturalHeight || undefined,
    };
  }, [frameRect, imageRef]);

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
    const box = frameRect();
    if (!box || !box.width || !box.height) return;
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

  /** How far a point is from the middle of the frame, which is the whole of
   *  the corner-pull maths: pulling a corner outward makes the picture bigger
   *  in exact proportion, and pushing it inward shrinks it back. */
  function reachFromCentre(pointer: Pointer): number | null {
    const box = frameRect();
    if (!box || !box.width || !box.height) return null;
    return Math.hypot(
      pointer.x - (box.left + box.width / 2),
      pointer.y - (box.top + box.height / 2),
    );
  }

  /**
   * Every gesture on a corner handle. It owns the pointer outright — the
   * surface underneath pans on the very same events, and would drag the
   * picture sideways while it was being zoomed.
   */
  const handleProps = {
    onPointerDown: (event: React.PointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const distance = reachFromCentre({ x: event.clientX, y: event.clientY });
      zoomFrom.current = {
        // A zero reach means the corner is on the centre, which only happens
        // for an unmeasurable frame; the tap path still works from it.
        distance: distance ?? 0,
        scale: current.current.scale,
        moved: false,
      };
      if (typeof event.currentTarget.setPointerCapture === "function") {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is a convenience: losing it costs only tracking once the
          // pointer leaves the handle.
        }
      }
    },
    onPointerMove: (event: React.PointerEvent<HTMLSpanElement>) => {
      const from = zoomFrom.current;
      if (!from) return;
      event.stopPropagation();
      const distance = reachFromCentre({ x: event.clientX, y: event.clientY });
      if (distance === null || from.distance <= 0) return;
      if (Math.abs(distance - from.distance) > ZOOM_SLOP) from.moved = true;
      apply(zoomPlacementTo(current.current, from.scale * (distance / from.distance)));
    },
    onPointerUp: (event: React.PointerEvent<HTMLSpanElement>) => {
      const from = zoomFrom.current;
      zoomFrom.current = null;
      if (!from) return;
      event.stopPropagation();
      // A press that went nowhere is a tap, and a tap on "make this bigger"
      // means one step bigger. This is the whole gesture on a phone.
      if (!from.moved) apply(zoomPlacement(current.current, ZOOM_STEP));
    },
    onPointerCancel: (event: React.PointerEvent<HTMLSpanElement>) => {
      zoomFrom.current = null;
      event.stopPropagation();
    },
    // The tile's own click handler would otherwise close the inspector.
    onClick: (event: React.MouseEvent<HTMLSpanElement>) =>
      event.stopPropagation(),
  };

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
      // Tells the grid cell that this block has an editing surface over it, so
      // the cell's own resize and rotate handles stand down: they sit under
      // this surface and cannot be pressed while it is up (see HANDLE_CLASS).
      data-block-overlay=""
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
      // A size container, so the corner handles and the hint below can be
      // written as a share of THIS TILE rather than in pixels that suit one
      // tile size and no other.
      className="absolute inset-0 z-30 cursor-grab touch-none rounded-[inherit] outline-none ring-[3px] ring-inset ring-accent [container-type:size] active:cursor-grabbing"
    >
      {/* The corner handles. Pull one outward to zoom in, push it in to zoom
          back out, or just tap it for a step.

          Deliberately NOT tab stops. Four identical controls per tile would be
          four stops that say the same thing, and zooming is already on this
          surface's own keyboard (+/-) and in the label a screen reader hears
          when it lands here. These are the POINTER affordance for a function
          that is already fully exposed. */}
      {ZOOM_HANDLES.map(({ corner, edge, Icon }) => (
        <span
          key={corner}
          {...handleProps}
          aria-hidden="true"
          data-testid={`tile-zoom-handle-${corner.replace(" ", "-")}`}
          style={{ ...edge, width: HANDLE_SIZE, height: HANDLE_SIZE }}
          className={cn(
            "absolute z-10 flex items-center justify-center rounded-full bg-black/55 text-white",
            "transition-colors duration-base ease-standard hover:bg-black/75 motion-reduce:transition-none",
            corner === "top right" || corner === "bottom left"
              ? "cursor-nesw-resize"
              : "cursor-nwse-resize",
          )}
        >
          <Icon className="size-[60%]" strokeWidth={2.5} aria-hidden="true" />
        </span>
      ))}

      {/* The mode has to be legible without a manual. Along the bottom rather
          than floating in the middle: the middle is the part being positioned.
          It stops short of the corners so the two handles down there stay
          pressable, and at the bottom of the zoom range it says the one thing
          that is actually useful — a picture that exactly fits has no pan left
          in it, so "drag to frame" would be advice that does nothing.

          Below about 11rem of tile there is no room left between the two
          bottom handles, and a sentence truncated to three characters is worse
          than no sentence: the arrows say what to do on their own, and the
          mode ring says which tile is in it. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-1/2 hidden max-w-[calc(100%-5rem)] -translate-x-1/2 truncate rounded-full bg-black/55 px-2 py-0.5 text-center font-inter text-[0.625rem] leading-tight text-white @min-[11rem]:inline"
      >
        {zoomed > IMAGE_SCALE_MIN
          ? `${zoomed}% · Drag to frame · Esc`
          : "Pull a corner to zoom · Esc"}
      </span>
    </div>
  );
}

export { IMAGE_SCALE_MAX, IMAGE_SCALE_MIN };
