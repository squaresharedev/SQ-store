"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  GripVertical,
  Image as ImageIcon,
  Type,
} from "lucide-react";
import { blockKey, layerOrder, type StorefrontBlock } from "@/types/storefront";
import type { Product } from "@/types/product";
import { dropIndex, type LayerOp } from "@/lib/storefront/layers";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import {
  focusRingInsetClass,
  infoTextClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { PanelBackRow } from "@/components/ui/PanelMenu";
import { BLOCK_KIND_LABELS, blockLabel } from "./block-label";
import { ShapeKindGlyph } from "./ShapeTileContent";
import { LAYER_BUTTON_CLASS, LAYER_CONTROLS } from "./PlacementSection";

/**
 * THE WHOLE STACK, front at the top, inside the design panel.
 *
 * WHY IT EXISTS. The four move buttons can only answer "move THIS one". They
 * cannot answer "what is under here", and once blocks overlap that is the
 * question a seller actually has: a word placed on a shape hides the shape,
 * and the only way back to it was Alt-clicking blind. A list names every block
 * on the board and hands back the one you point at.
 *
 * WHY IN THE PANEL, NOT OVER THE CANVAS. A floating layers window covers the
 * board it describes, and on a phone it would be a second sheet fighting the
 * one already there. This replaces the panel's body instead, so opening it
 * costs the canvas nothing it had not already given up.
 *
 * FRONT AT THE TOP. The opposite of the z values underneath (0 is furthest
 * back), and the same way round as every other layers list a seller has used.
 * The conversion lives in this file alone: `rowIndex` counts from the front,
 * `moveLayerTo` counts from the back, and {@link dropIndex} is the one place
 * the two meet.
 *
 * ROWS EXPAND. Collapsed, a row is an identity and a target. Expanded, it is
 * where that block's four moves live, so the list can reorder without a drag —
 * which is what keyboard and screen-reader users have instead of one, and what
 * anyone has when the stack is taller than the panel.
 */

/** How far a pointer must travel before a press on the grip becomes a drag
 *  rather than a click. Below this the row still selects, so the grip is not a
 *  dead zone on a list you are only reading. */
const DRAG_SLOP = 4;

/**
 * The block itself, at 28px.
 *
 * A picture where there is one (the product photo, the uploaded element) and
 * the real shape in its real colour where there is not, because a list of four
 * identical grey squares is a list you have to read every word of. Shape
 * colours go through the hex gate before touching a style attribute, exactly
 * as ShapeTileContent does with the same values.
 */
function LayerThumb({
  block,
  productsById,
  elementUrls,
}: {
  block: StorefrontBlock;
  productsById: ReadonlyMap<string, Product>;
  elementUrls: Record<string, string>;
}) {
  const box =
    "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted";

  if (block.type === "shape") {
    const color = isStrictHexColor(block.color) ? block.color : undefined;
    return (
      <span
        className={cn(box, "text-muted-foreground")}
        style={color ? { color } : undefined}
      >
        <ShapeKindGlyph kind={block.kind} />
      </span>
    );
  }

  if (block.type === "text") {
    return (
      <span className={box}>
        <Type
          className="size-4 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
      </span>
    );
  }

  const src =
    block.type === "product"
      ? (productsById.get(block.productId)?.imageUrl ?? null)
      : (elementUrls[blockKey(block)] ?? null);

  return (
    <span className={box}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL; plain img for a 28px thumbnail.
        <img
          src={src}
          alt=""
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        <ImageIcon
          className="size-4 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export function LayersPanel({
  blocks,
  productsById,
  elementUrls,
  selectedKeys,
  onSelect,
  onReorder,
  onMoveTo,
  onBack,
}: {
  /** Every block on the board. Order here is meaningless; the list sorts. */
  blocks: readonly StorefrontBlock[];
  productsById: ReadonlyMap<string, Product>;
  /** Display URLs for uploaded elements, keyed by blockKey. */
  elementUrls: Record<string, string>;
  selectedKeys: readonly string[];
  /** Plain press selects ONLY that block; `additive` extends the selection,
   *  the same contract the canvas's shift-click has. */
  onSelect: (key: string, additive: boolean) => void;
  onReorder: (key: string, op: LayerOp) => void;
  /** Drop one block at `index` in the back-to-front order, counted in the
   *  blocks that are NOT moving (lib/storefront/layers' dropIndex converts
   *  from this list's front-first rows). */
  onMoveTo: (key: string, index: number) => void;
  onBack: () => void;
}) {
  // Front first, which is the opposite of the paint order underneath.
  const ordered = useMemo(
    () => layerOrder([...blocks]).reverse(),
    [blocks],
  );
  const total = ordered.length;
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  // One row open at a time: two expanded rows in a 320px column push the rest
  // off screen, and the details are a detour, not a comparison.
  const [expanded, setExpanded] = useState<string | null>(null);

  const [drag, setDrag] = useState<{
    key: string;
    from: number;
    to: number;
    /** Pixels travelled, so the grabbed row tracks the finger exactly. */
    offset: number;
    rowHeight: number;
    /** Still inside DRAG_SLOP: nothing has moved yet and a release is a click. */
    idle: boolean;
  } | null>(null);
  const dragOrigin = useRef(0);

  function startDrag(event: React.PointerEvent<HTMLElement>, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const handle = event.currentTarget;
    const row = handle.closest<HTMLElement>("[data-layer-row]");
    const rowHeight = row?.getBoundingClientRect().height ?? 0;
    if (rowHeight <= 0) return;
    // Uniform row heights are what the drop-index arithmetic below rests on,
    // so the open row closes before anything can be measured against it.
    setExpanded(null);
    handle.setPointerCapture(event.pointerId);
    dragOrigin.current = event.clientY;
    setDrag({
      key: blockKey(ordered[index]),
      from: index,
      to: index,
      offset: 0,
      rowHeight,
      idle: true,
    });
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    if (!drag) return;
    const offset = event.clientY - dragOrigin.current;
    if (drag.idle && Math.abs(offset) < DRAG_SLOP) return;
    const to = Math.max(
      0,
      Math.min(total - 1, drag.from + Math.round(offset / drag.rowHeight)),
    );
    setDrag({ ...drag, offset, to, idle: false });
  }

  function endDrag() {
    if (!drag) return;
    const { key, from, to, idle } = drag;
    setDrag(null);
    // A press that never travelled is a press on the row: select, so the grip
    // is not a hole in the middle of the target.
    if (idle) onSelect(key, false);
    else if (to !== from) onMoveTo(key, dropIndex(to, total));
  }

  /** Arrow keys on the grip, so the list reorders without a pointer. Up is
   *  toward the front because up is where the front is drawn. */
  function onGripKeyDown(event: React.KeyboardEvent, key: string) {
    const up = event.key === "ArrowUp";
    const down = event.key === "ArrowDown";
    if (!up && !down) return;
    event.preventDefault();
    // Shift sends it the whole way, matching the modifier the Ctrl+bracket
    // shortcuts already spend on exactly that.
    onReorder(
      key,
      up
        ? event.shiftKey
          ? "front"
          : "forward"
        : event.shiftKey
          ? "back"
          : "backward",
    );
  }

  /** How far a row is displaced by the drag in progress. The grabbed row
   *  follows the pointer; the rows it has passed step aside by exactly one row,
   *  so the gap the drop will fill is always visible. */
  function rowShift(index: number): number {
    if (!drag || drag.idle) return 0;
    if (index === drag.from) return drag.offset;
    if (drag.to > drag.from && index > drag.from && index <= drag.to) {
      return -drag.rowHeight;
    }
    if (drag.to < drag.from && index >= drag.to && index < drag.from) {
      return drag.rowHeight;
    }
    return 0;
  }

  return (
    <div>
      <PanelBackRow
        title="Layers"
        ariaLabel="Back to the selected block, leaving Layers"
        onBack={onBack}
      />

      {total === 0 ? (
        <p className={cn(infoTextClass, "px-0 py-4 lg:px-4")}>
          Nothing on the canvas yet. Blocks appear here as you add them.
        </p>
      ) : (
        <>
          <ul
            // Depth is the ONLY thing this list orders by, and the board's
            // reading order is untouched by everything in it.
            aria-label="Canvas layers, front to back"
            className="relative"
          >
            {ordered.map((block, index) => {
              const key = blockKey(block);
              const isSelected = selected.has(key);
              const isOpen = expanded === key;
              const grabbed = drag?.key === key && !drag.idle;
              const shift = rowShift(index);
              const label = blockLabel(block, productsById);
              return (
                <li
                  key={key}
                  style={
                    shift === 0 ? undefined : { transform: `translateY(${shift}px)` }
                  }
                  className={cn(
                    "border-b border-border bg-background",
                    grabbed
                      ? "relative z-10 shadow-md"
                      : "transition-transform duration-fast ease-standard motion-reduce:transition-none",
                  )}
                >
                  <div
                    data-layer-row=""
                    className={cn(
                      "flex h-11 items-center gap-1 lg:pr-2",
                      isSelected && "bg-accent",
                    )}
                  >
                    {/* Grip: drag to reorder with a pointer, arrows to reorder
                        without one. A button rather than a bare span so it is
                        reachable at all by keyboard. */}
                    <button
                      type="button"
                      aria-label={`Reorder ${label}`}
                      title="Drag to reorder"
                      onPointerDown={(event) => startDrag(event, index)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => onGripKeyDown(event, key)}
                      className={cn(
                        "flex h-11 w-6 shrink-0 touch-none items-center justify-center rounded-none",
                        "text-muted-foreground hover:text-foreground",
                        drag?.key === key ? "cursor-grabbing" : "cursor-grab",
                        transitionClass,
                        focusRingInsetClass,
                      )}
                    >
                      <GripVertical
                        className="size-4"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>

                    {/* The row itself IS the selection control: pointing at a
                        layer is asking for that block, which is the whole
                        reason to look at this list. */}
                    <button
                      type="button"
                      onClick={(event) =>
                        onSelect(key, event.shiftKey || event.metaKey || event.ctrlKey)
                      }
                      aria-pressed={isSelected}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2.5 rounded-none py-1 pr-1 text-left",
                        "hover:bg-accent",
                        transitionClass,
                        focusRingInsetClass,
                      )}
                    >
                      <LayerThumb
                        block={block}
                        productsById={productsById}
                        elementUrls={elementUrls}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={cn(
                            "truncate font-inter text-sm text-foreground",
                            isSelected && "font-medium",
                          )}
                        >
                          {label}
                        </span>
                        <span className={cn(infoTextClass, "truncate")}>
                          {BLOCK_KIND_LABELS[block.type]}
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : key)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} layer options for ${label}`}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-none",
                        "text-muted-foreground hover:bg-accent hover:text-foreground",
                        transitionClass,
                        focusRingInsetClass,
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform duration-fast ease-standard motion-reduce:transition-none",
                          isOpen && "rotate-180",
                        )}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="flex items-center justify-between gap-2 pb-3 pl-6 pr-2 lg:pl-7">
                      <span className={infoTextClass}>
                        {/* Counted from the BACK, the way the four buttons and
                            the placement readout already count, so the two
                            never disagree about which layer this is. */}
                        Layer {total - index} of {total}
                      </span>
                      <div
                        role="group"
                        aria-label={`Move ${label}`}
                        className="flex gap-1"
                      >
                        {LAYER_CONTROLS.map(({ op, label: action, icon: Icon, end }) => (
                          <button
                            key={op}
                            type="button"
                            onClick={() => onReorder(key, op)}
                            aria-label={`${action}: ${label}`}
                            disabled={
                              end === "front" ? index === 0 : index === total - 1
                            }
                            className={LAYER_BUTTON_CLASS}
                          >
                            <Icon
                              className="size-4"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <ShortcutHint />
        </>
      )}
    </div>
  );
}

/** Nothing to subscribe to: the platform cannot change under a running tab.
 *  The store exists only so the SERVER and the CLIENT can answer differently
 *  without it being a hydration mismatch. */
const NEVER_CHANGES = () => () => {};

const readModifier = () =>
  /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** Ctrl is the honest default, being what every platform except one uses. */
const SERVER_MODIFIER = () => "Ctrl";

/**
 * The keyboard equivalent, spelled out where the stack is being looked at.
 *
 * The modifier is read through useSyncExternalStore rather than in an effect:
 * the server has no platform to read, and this is exactly the "server and
 * client disagree, on purpose" case React built that hook's third argument for.
 */
function ShortcutHint() {
  const mod = useSyncExternalStore(
    NEVER_CHANGES,
    readModifier,
    SERVER_MODIFIER,
  );
  return (
    <p className={cn(infoTextClass, "py-3 lg:px-4")}>
      {mod} + [ and {mod} + ] move the selection one layer. Add Shift to send it
      all the way.
    </p>
  );
}
