"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { BADGE_DRAG_THRESHOLD_PX, PHOTO_PLACEMENTS, photoCornerAt } from "./ProductBadges";
import type { BadgePlacement } from "@/types/product";

/**
 * MOVING A BADGE ON THE PRODUCT PAGE ITSELF, in the storefront editor.
 *
 * The same move as the product form's drag (BadgePlacementPreview), done on
 * the real page instead of a miniature: grab a badge, and the photo's four
 * corners and the space under the title light up as places to let go. The
 * page stays the buyer's page: without a BadgeMoveProvider above it (the
 * public route) none of this renders, and ProductPageView only reaches for it
 * in preview mode.
 *
 * Pointer events on window while a drag is live, so a finger works as well as
 * a mouse and the badge re-rendering in its new place cannot drop the drag.
 * The pill that follows the pointer is a copy laid on the document body: the
 * artboard scales the page and clips the photo, and the copy must be neither.
 */

type BadgeMover = {
  /** Whether the badge with these words may go there (the photo holds
   *  BADGES_ON_PHOTO_MAX at most). */
  canPlace: (label: string, placement: BadgePlacement) => boolean;
  /** Move it. Only called with a place `canPlace` allowed. */
  onPlace: (label: string, placement: BadgePlacement) => void;
  /** A drop the photo had no room for. */
  onRefused: () => void;
  /** The editor's words, in the seller's language: handed in rather than
   *  looked up here, so the buyer's page never ships the editor's messages. */
  copy: { hint: string; beside: string };
};

type Drag = {
  label: string;
  from: BadgePlacement;
  target: BadgePlacement | null;
  allowed: boolean;
};

type BadgeDragState = {
  drag: Drag | null;
  copy: BadgeMover["copy"];
  register: (kind: ZoneKind, element: HTMLElement | null) => void;
  start: (event: ReactPointerEvent<HTMLElement>, from: ZoneKind) => void;
};

type ZoneKind = "photo" | "beside";

const BadgeDragContext = createContext<BadgeDragState | null>(null);

/** The pill that follows the pointer: laid over everything, lifted. */
const GHOST_CLASSES = ["pointer-events-none", "fixed", "z-50", "m-0", "origin-top-left", "whitespace-nowrap", "shadow-md"];
/** The badge left behind while its copy is carried: still there, clearly
 *  the one moving. */
const LEFT_BEHIND_CLASS = "opacity-30";

export function BadgeMoveProvider({
  canPlace,
  onPlace,
  onRefused,
  copy,
  children,
}: BadgeMover & { children: ReactNode }) {
  const zones = useRef(new Map<ZoneKind, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const latest = useRef({ canPlace, onPlace, onRefused });
  useEffect(() => {
    latest.current = { canPlace, onPlace, onRefused };
  });
  useEffect(() => () => cleanup.current?.(), []);

  const register = useCallback((kind: ZoneKind, element: HTMLElement | null) => {
    if (element) zones.current.set(kind, element);
    else zones.current.delete(kind);
  }, []);

  /** The place under a point: a corner of the photo, beside the product, or
   *  nowhere. */
  const placeAt = useCallback((x: number, y: number): BadgePlacement | null => {
    const photo = zones.current.get("photo")?.getBoundingClientRect();
    const corner = photo ? photoCornerAt(photo, x, y) : null;
    if (corner) return corner;
    const beside = zones.current.get("beside")?.getBoundingClientRect();
    if (beside && x >= beside.left && x <= beside.right && y >= beside.top && y <= beside.bottom) {
      return "beside";
    }
    return null;
  }, []);

  const start = useCallback(
    (event: ReactPointerEvent<HTMLElement>, zone: ZoneKind) => {
      if (event.button !== 0) return;
      const pill = (event.target as Element).closest<HTMLElement>("[data-badge-label]");
      const label = pill?.getAttribute("data-badge-label");
      if (!pill || !label) return;
      // The press is the badge's: no text selection, no canvas gesture.
      event.preventDefault();
      event.stopPropagation();
      cleanup.current?.();

      const from: BadgePlacement =
        zone === "beside"
          ? "beside"
          : ((pill.closest("[data-badge-corner]")?.getAttribute("data-badge-corner") as BadgePlacement | null) ??
            "photo-top-left");
      const rect = pill.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const startX = event.clientX;
      const startY = event.clientY;
      let ghost: HTMLElement | null = null;

      const follow = (x: number, y: number) => {
        if (!ghost) {
          ghost = pill.cloneNode(true) as HTMLElement;
          ghost.removeAttribute("data-badge-label");
          ghost.setAttribute("data-badge-ghost", "");
          ghost.setAttribute("aria-hidden", "true");
          ghost.classList.add(...GHOST_CLASSES);
          pill.classList.add(LEFT_BEHIND_CLASS);
          Object.assign(ghost.style, {
            transform: `scale(${pill.offsetWidth ? rect.width / pill.offsetWidth : 1})`,
            fontFamily: getComputedStyle(pill).fontFamily,
          });
          document.body.appendChild(ghost);
        }
        ghost.style.left = `${x - offsetX}px`;
        ghost.style.top = `${y - offsetY}px`;
      };

      const onMove = (move: PointerEvent) => {
        if (!ghost && Math.hypot(move.clientX - startX, move.clientY - startY) <= BADGE_DRAG_THRESHOLD_PX) {
          return;
        }
        follow(move.clientX, move.clientY);
        const target = placeAt(move.clientX, move.clientY);
        const allowed = target === null || latest.current.canPlace(label, target);
        setDrag((was) =>
          was && was.target === target && was.allowed === allowed ? was : { label, from, target, allowed },
        );
      };

      const onUp = (up: PointerEvent) => {
        const dragged = ghost !== null;
        finish();
        if (!dragged) return;
        const target = placeAt(up.clientX, up.clientY);
        if (!target || target === from) return;
        if (!latest.current.canPlace(label, target)) {
          latest.current.onRefused();
          return;
        }
        latest.current.onPlace(label, target);
      };

      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", finish);
        ghost?.remove();
        ghost = null;
        pill.classList.remove(LEFT_BEHIND_CLASS);
        cleanup.current = null;
        setDrag(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", finish);
      cleanup.current = finish;
    },
    [placeAt],
  );

  const value = useMemo(() => ({ drag, copy, register, start }), [drag, copy, register, start]);
  return <BadgeDragContext.Provider value={value}>{children}</BadgeDragContext.Provider>;
}

/** Every badge inside a zone: grabbable, and (on the photo, whose overlay
 *  lets clicks through to the picture) the one thing on it that catches a
 *  press. `touch-none` so a finger drags the badge rather than the page. */
const MOVABLE_PILLS_CLASS =
  "[&_[data-badge-label]]:pointer-events-auto [&_[data-badge-label]]:cursor-grab [&_[data-badge-label]]:touch-none [&_[data-badge-label]]:select-none";

/**
 * One place a badge can go: the photo (its four corners) or the space beside
 * the product. Without a BadgeMoveProvider above it, only its children.
 */
export function BadgeDropZone({
  kind,
  children,
}: {
  kind: ZoneKind;
  /** The badges already there, or null for none. */
  children: ReactNode;
}) {
  const state = useContext(BadgeDragContext);
  const register = state?.register;
  const ref = useCallback((element: HTMLDivElement | null) => register?.(kind, element), [register, kind]);
  if (!state) return <>{children}</>;
  const { drag, copy } = state;

  if (kind === "photo") {
    return (
      <div
        ref={ref}
        className={cn("pointer-events-none absolute inset-0", MOVABLE_PILLS_CLASS)}
        onPointerDown={(event) => state.start(event, "photo")}
        title={copy.hint}
        data-badge-zone="photo"
      >
        {/* While dragging: the four quarters, the one under the pointer lit. */}
        {drag && (
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2" aria-hidden="true">
            {PHOTO_PLACEMENTS.map((corner) => (
              <div
                key={corner}
                className={cn(
                  "border border-dashed border-white/70 bg-black/5",
                  drag.target === corner && (drag.allowed ? "bg-white/40" : "bg-destructive/30"),
                )}
                data-badge-drop={corner}
                data-badge-drop-active={drag.target === corner ? (drag.allowed ? "yes" : "refused") : undefined}
              />
            ))}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-sm",
        MOVABLE_PILLS_CLASS,
        // Out of the column while there is nothing to show; while dragging, a
        // visible place to let go, even when it is empty.
        !drag && !children && "hidden",
        drag && "-m-1.5 min-h-10 border border-dashed border-current p-1.5 opacity-90",
        drag?.target === "beside" && "bg-current/10",
      )}
      onPointerDown={(event) => state.start(event, "beside")}
      title={copy.hint}
      data-badge-zone="beside"
      data-badge-drop-active={drag?.target === "beside" ? "yes" : undefined}
    >
      {children}
      {drag && !children && (
        <p className="text-xs opacity-70" aria-hidden="true">
          {copy.beside}
        </p>
      )}
    </div>
  );
}
