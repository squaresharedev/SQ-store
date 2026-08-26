# Prompt 1 of 3: Block rotation

> **Superseded on one point, deliberately, after this shipped.** Rotation is no
> longer purely visual: a turned block covers its own rect TRANSPOSED about the
> same centre, derived by `blockFootprint` / `rotatedFootprint`
> (`lib/geometry/rotated-box.ts`). Same number of cells, the other way round.
> `x/y/w/h` still store the unrotated rect, so turning a block never resizes it,
> never moves it, and turning it back restores it exactly; the schema still
> checks that stored rect, and a turned block's corners may hang past the
> board's edge.
>
> Edge-grab resize also moved OUT of the block's own turned space and into
> screen space, on the footprint. "Hit testing a rotated cell" below describes
> the old scheme, which inverted at half a turn: dragging the top edge upwards
> grew the block downwards.
>
> Blocks may also overlap now; see `02-block-layering.md`.

Give every storefront block an optional rotation angle, editable by a drag
handle on the tile, by the keyboard, and by a control in the design panel.

This is the first of three prompts that together turn the storefront canvas
into a freeform design surface:

1. **Rotation** (this document)
2. **Layering** (`02-block-layering.md`) - explicit stacking order
3. **Freeform placement** (`03-freeform-placement.md`) - the grid/free mode
   switch and fractional coordinates

Ship them in that order. Rotation is deliberately first because it needs no
change to the placement invariants: a rotated block still occupies exactly the
cells it always did, so nothing in the schema's non-overlap rule, the
small-screen reflow, or the embed payload has to move yet. It does, however,
force two real fixes in the shared grid's gesture code (see "The transform
collision" and "Hit testing a rotated cell"), and those fixes are what make
prompts 2 and 3 possible.

---

## Before you write anything

Read these, in this order:

- `AGENTS.md` at the repo root. This is **not** the Next.js in your training
  data. Read the relevant guide in `node_modules/next/dist/docs/` before
  writing route or framework code.
- `docs/styles.md`. Every class must come from the token scale. Radius tokens
  (`rounded-sm`/`md`/`lg`) and motion tokens (`duration-base`, `duration-slow`,
  `ease-standard`, `ease-entrance`) are real. Never hand-spell
  `duration-180` or `ease-[cubic-bezier(...)]`.
- `src/types/storefront.ts`, top-of-file comment. It states the config
  contract: renderable as typed React data only, no HTML, no URLs, no free-form
  CSS. Rotation is a bounded integer, so it fits without argument.
- `src/components/grid/Grid.tsx` and `src/components/grid/gridConstants.ts`.
  The grid is presentation-agnostic and is reused by the marketplace later, so
  anything you add there must not reference storefront concepts.

House rules that apply to every file you touch:

- **No em dashes** anywhere: prose, UI copy, comments, commit messages. Use
  commas, colons or parentheses.
- Comments in this codebase explain *why*, not *what*. Match that density and
  voice. Do not add narration.
- Optional config fields are **dropped when they equal the default**, so a
  block nobody touched stays byte-identical to one saved before the field
  existed. Rotation follows that rule: `rotation === 0` must delete the key.

---

## The model change

### `src/types/storefront.ts`

Add to `BlockPlacement`, so all four block kinds inherit it from one place:

```ts
export const ROTATION_MIN = -180;
export const ROTATION_MAX = 180;

/** Where a block sits on the canvas and how many cells it covers. */
export type BlockPlacement = {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Clockwise tilt in whole degrees, ROTATION_MIN..ROTATION_MAX. Absent = 0,
   * and a block rotated back to 0 drops the key again, so an untilted block
   * is indistinguishable from one saved before this existed.
   *
   * PURELY VISUAL. The block still occupies exactly the cells x/y/w/h name:
   * the non-overlap rule, the reading order and the small-screen reflow all
   * read the unrotated box, and a tilted corner may paint over a neighbour.
   */
  rotation?: number;
};
```

Add two helpers next to it:

```ts
/** Fold any angle into ROTATION_MIN..ROTATION_MAX as a whole degree, so a
 *  handle that has been spun several turns still stores one bounded int. */
export function normalizeRotation(degrees: number): number;

/** A placement patch that SETS or CLEARS the tilt. Returns the block
 *  unchanged when the angle is already what it asks for, so a no-op drag
 *  cannot dirty the editor. */
export function withRotation<T extends BlockPlacement>(
  block: T,
  degrees: number,
): T;
```

`withRotation` deletes the key when the normalized angle is 0. That single
writer is what keeps the "absent = untouched" invariant true; nothing else may
assign `rotation` directly.

### `src/lib/validation/storefront.ts`

One line, in `placementFields` (around line 373), so every block kind gets it:

```ts
const placementFields = {
  x: ...,
  y: ...,
  w: ...,
  h: ...,
  rotation: z.number().int().min(ROTATION_MIN).max(ROTATION_MAX).optional(),
};
```

Nothing in the config-level `superRefine` changes. Rotation is visual, so the
"inside the canvas" and "blocks cannot overlap" checks keep reading the
unrotated box, deliberately.

### The mirror

`docs/agent-surface.md` states that the published schemas package is the
**canonical** storefront contract and that edits here must be mirrored into it.
Mirror the `placementFields` change and bump the package version. Do not skip
this: an agent writing a config against the old package would produce blocks
the app accepts but the package rejects.

### The embed payload

`src/app/api/embed/[key]/route.ts`, `publicBlocks()`. The `placement` object at
the top of the map covers all four kinds, so this is one line:

```ts
const placement = {
  x: block.x,
  y: block.y,
  w: block.w,
  h: block.h,
  ...(block.rotation !== undefined ? { rotation: block.rotation } : {}),
};
```

Spread rather than an unconditional `rotation: block.rotation`, so a payload
for an untilted board is byte-identical to what the widget receives today.
Rotation belongs in the public payload for exactly the reason `imagePlacement`
does: it is a visual choice the seller made about a block the buyer can already
see, and an embed that dropped it would silently straighten every tilted tile.

---

## Rendering

### The transform collision, and why `rotate` not `transform`

`Grid.tsx`'s gesture painter writes `cell.style.transform` imperatively on
every animation frame of a drag or resize (see `paintGesture`). If rotation
also went through `transform`, the painter would wipe it on the first
pointermove.

Use the **individual transform properties** instead. They are separate CSS
properties, so they compose without either side knowing about the other:

- Block rotation renders as `rotate: ${degrees}deg` on the grid cell.
- The gesture painter writes `cell.style.translate` instead of
  `cell.style.transform`.

This is not only a collision fix, it is a correctness fix. The individual
properties compose as `translate * rotate * scale * transform`, so a drag offset
written to `translate` is applied **outside** the rotation and moves the tile in
screen space. Had the offset stayed in `transform` it would have been applied
*inside* the rotation, and dragging a tile tilted 30 degrees would have sent it
off at 30 degrees to the cursor.

Concretely, in `Grid.tsx`:

- `paintGesture`: `cell.style.translate = \`${x}px ${y}px\`` for both the move
  and the resize branch.
- `clearGestureStyles`: clear `translate`, not `transform`.
- The `willChange` hint on a cell under gesture becomes `translate`.
- Leave the stage's own pan/zoom transform in `DesignerCanvas` alone. That is a
  different element and has no conflict.

Browser support for `rotate` and `translate` as standalone properties is
Chrome 104, Firefox 72, Safari 14.1. Well inside the support floor.

### Where the style is applied

Add to `src/components/storefront/config-maps.ts`, beside the other enum and
number to style helpers:

```ts
/** The tilt one block wears. Emitted as the standalone `rotate` property, not
 *  inside `transform`: the grid paints live drag offsets straight into
 *  `translate`, and the two must be able to coexist on one cell. */
export function blockRotationStyle(rotation: number | undefined): CSSProperties;
```

Returns `{}` when the rotation is absent or 0, so an untilted cell gets no
extra property at all.

Call it from the two `cellStyle` callbacks that already exist:

- `src/components/storefront/DesignerCanvas.tsx`, the `cellStyle` prop on
  `<Grid>` (it already spreads `tileClipStyle(...)` and the framing z-index).
- `src/components/storefront/StorefrontPreview.tsx`, same place.

Because the whole cell rotates, the tile's clip, its border, its selection ring
and its control chip all rotate with it. That is what Figma and Canva do, and it
is what makes the tilt read as a property of the object rather than a skin on
top of it.

### What does NOT rotate

- **The drag ghost.** It marks the cells the block will land in, which is a
  board-space fact. Leave it unrotated.
- **`CarouselStrip`.** Carousel display mode already abandons coordinates and
  reads the board as a line. Rotation is a canvas property and is ignored there,
  the same way `x`/`y` are. Add a one-line comment saying so, so the omission
  reads as a decision.
- **The masthead.** It is not a block.

### Spill past the board edge

A tilted tile's painted box is larger than its cell: a square rotated 45 degrees
grows its axis-aligned box by about 41 percent. At the design cell size of 96px
that is roughly 20px of spill per side, and the canvas frame's own `p-4` padding
absorbs most of it.

For this prompt, **do not clip**. The board keeps its current overflow
behaviour in the editor, the preview and the embed, so all three agree. Prompt 3
revisits clipping once blocks can be placed anywhere.

---

## The rotate gesture

### The handle

`Grid.tsx` already owns the resize handle and renders it from `HANDLE_CLASS`.
Add a rotate handle beside it, gated by a new optional callback so the
marketplace consumer is never forced to implement rotation:

```ts
/** Optional even in editable mode: a consumer that does not offer rotation
 *  simply omits it and no handle is drawn. */
onRotate?: (key: string, rotation: number) => void;
```

Place it at the cell's **bottom-left**, mirroring the bottom-right resize
handle, using the same `HANDLE_CLASS` chrome and lucide's `RotateCw` at
`size-3.5`, `strokeWidth={2}`. Inside the cell rather than floating outside it,
so a 1x1 tile at the board edge still has a reachable handle.

### The math

Put the pure parts in a new `src/components/grid/rotationMath.ts` so they are
unit-testable without a DOM:

```ts
/** The angle from a centre to a point, in degrees, clockwise from 12 o'clock. */
export function angleFromCenter(
  center: { x: number; y: number },
  point: { x: number; y: number },
): number;

/** Snap to the nearest multiple, used for the Shift-held 15 degree detents. */
export function snapAngle(degrees: number, step: number): number;

/** Rotate a point back into an element's own unrotated space, about its
 *  centre. This is what makes edge hit-testing work on a tilted cell. */
export function toLocalPoint(
  center: { x: number; y: number },
  degrees: number,
  point: { x: number; y: number },
): { x: number; y: number };
```

`ROTATION_SNAP_STEP = 15`, matching Sketch, Figma and Illustrator.

### The gesture itself

Model it on `startResize`: subscribe window listeners on pointerdown, paint
imperatively through `gestureRef` plus one rAF, commit once on pointerup.

Critically, **derive the cell's centre from the grid rect and the strides, not
from `cell.getBoundingClientRect()`**. On a rotated element that call returns
the axis-aligned bounding box, whose centre happens to be right but whose size
is not, and the same wrong-box problem bites the resize code (next section).
`readStrides()` already measures the grid root, so:

```
centerX = gridRect.left + (block.x + block.w / 2) * strideX - gapX / 2
centerY = gridRect.top  + (block.y + block.h / 2) * strideY - gapY / 2
```

Then:

1. On pointerdown, record `originRotation = block.rotation ?? 0` and the
   pointer's angle from that centre.
2. On pointermove, `next = normalizeRotation(originRotation + (currentAngle -
   startAngle))`, snapped to 15 degrees while Shift is held.
3. Paint `cell.style.rotate = \`${next}deg\`` and write the live angle into a
   readout chip (see below), both inside the existing rAF.
4. On pointerup, call `onRotate(block.key, next)` only when the angle actually
   changed, then clear the imperative style so React owns it again.

Use the existing `setDragCursorLock` so the drag never selects text, and
register the same `pointercancel` teardown and `cleanupRef` unmount teardown the
other gestures use. A gesture that leaks window listeners on unmount is the one
failure mode this file has already been careful about twice.

### The readout

A small chip showing the live angle, positioned near the handle, written
imperatively (textContent plus a `display` flip) so a 60Hz spin causes zero
re-renders. Same technique as the marquee band in `DesignerCanvas`. Token
chrome: `rounded-sm border border-border bg-background/95 font-inter text-xs`.

Double-clicking the handle resets the block to 0 degrees. That is the fastest
undo of a spin that went wrong, and it costs one `onDoubleClick`.

---

## Hit testing a rotated cell

Two existing code paths measure a cell with `getBoundingClientRect()` and are
wrong the moment the cell is tilted. Both must be fixed in this prompt, not
deferred.

### 1. Edge-grab resize zones

`edgesUnderPointer(rect, x, y)` in `gridConstants.ts` compares the pointer
against the rect's sides. On a tilted cell the rect is the bounding box, so the
grab zones sit in the wrong place and drift further as the angle grows.

Give it an optional rotation and un-rotate the point first:

```ts
export function edgesUnderPointer(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  grab: number = EDGE_GRAB_PX,
  rotation = 0,
): ResizeEdges | null;
```

When `rotation` is non-zero, map the point through `toLocalPoint` about the
rect's centre before the existing comparison. The rest of the function is
unchanged.

Also rotate the **cursor** choice. `edgeCursor(edges)` returns `ns-resize` for a
top or bottom edge, which is visibly wrong on a tile tilted 45 degrees. Give it
the same optional rotation and pick from the four resize cursors by rotating the
edge normal, snapping to the nearest 45 degree bucket.

### 2. Resize anchoring

`startEdgeResize` and `startResize` both capture `cell.getBoundingClientRect()`
once and derive the board origin from it, with a comment explaining that a fresh
rect mid-drag would measure the preview. On a tilted cell the very first capture
is already the wrong box.

Replace the capture with the cell's box computed from the grid rect and the
strides, which is exact, rotation-independent, and removes the "captured once,
never re-read" fragility entirely:

```
cellLeft = gridRect.left + block.x * strideX
cellTop  = gridRect.top  + block.y * strideY
cellW    = block.w * cellWidth + (block.w - 1) * gapX
cellH    = block.h * cellHeight + (block.h - 1) * gapY
```

`readStrides()` already returns everything needed. Do this before wiring the
rotate gesture, since the rotate gesture derives its centre the same way.

### 3. Accepted imprecision

`DesignerCanvas`'s marquee selection hit-tests cells with
`getBoundingClientRect()`, so a tilted tile presents its bounding box to the
rubber band and is a little easier to catch than its painted shape. That is the
standard behaviour in every design tool and needs no fix. Add one comment saying
it is deliberate.

### 4. Known limitation to state in a comment

Resizing a rotated block is anchored in **board space**, so the pinned edge
appears to swing as the block grows. Correcting it means compensating the
placement so the local-space anchor stays fixed, which produces fractional
coordinates and therefore cannot land while placement is integer cells. Prompt 3
adds the compensation once free placement makes fractions legal. Say so in a
comment where the resize commits, so the next reader knows it is a queued fix
rather than an oversight.

---

## Keyboard and accessibility

The grid already binds arrows to move and Shift+arrows to resize, and the
designer already owns Ctrl/Cmd+Z, +C, +V and the zoom keys. Rotation takes:

| Keys | Action |
| --- | --- |
| `Alt` + `Left` / `Right` | rotate by 1 degree |
| `Alt` + `Shift` + `Left` / `Right` | rotate by 15 degrees |

Bind these in `Grid.tsx`'s `onCellKeyDown`, next to the existing arrow handling,
and only when `onRotate` is present. `Alt+Left` and `Alt+Right` are browser
Back and Forward on Windows, so `preventDefault()` is required, not optional.
Because the binding lives on the cell rather than on the window, it only fires
when a tile actually has focus.

For assistive technology:

- The rotate handle is a real `<button>` with
  `aria-label={\`Rotate ${label}\`}`, taking the same `getBlockLabel` the resize
  handle uses.
- Give the handle `role="slider"` with `aria-valuemin={-180}`,
  `aria-valuemax={180}`, `aria-valuenow={rotation ?? 0}` and
  `aria-valuetext={\`${rotation ?? 0} degrees\`}`, which is the accessible
  pattern for a draggable handle that carries a value.
- Add one `aria-live="polite"` region to the grid, updated on commit only (not
  during the drag), announcing the settled angle. Announcing every frame is
  worse than announcing nothing.

---

## The panel control

Create `src/components/storefront/PlacementSection.tsx`. This is the shared
"where and how this block sits" group for the Selection tab, and prompts 2 and 3
both add to it, so build it as a section from the start rather than bolting
rotation onto one of the four block editors.

Contents for this prompt:

- Label "Rotation", with the current angle on the right in `helpTextClass`
  ("0 degrees" when absent, so "follow the default" reads as a state).
- A `Slider` from `@/components/ui/slider`, min -180, max 180, step 1, with
  `ariaLabel="Block rotation"` and a `valueText` that spells the degrees.
- A row of quick buttons: -90, 0, +90. The 0 button is the reset and must clear
  the field rather than write a zero.

Use `labelClass`, `helpTextClass` and `infoTextClass` from
`@/components/ui/control-styles`, exactly as `LayoutSection.tsx` does. Do not
invent new control chrome.

Wire it in `StorefrontDesigner.tsx`:

- Render `PlacementSection` in the inspector slot, above the type-specific block
  editor, for **any** selection including a mixed multi-selection. Rotation
  applies to every block kind, so unlike card style it needs no per-type gating.
- Add `rotateBlocks(keys: readonly string[], degrees: number)` beside the other
  key-list mutators around line 1630. It follows their established shape: take a
  key list, call `recordChange(\`rotate:${keys.join()}\`)` so a slider drag
  coalesces into one undo step, map over blocks with `withRotation`.
- Multi-select rotates each block about **its own** centre, not the group's
  bounding box. Group-relative rotation needs the free coordinate space and
  belongs to prompt 3. Say so in the function's comment.
- The canvas callback for the handle goes through the same identity-stable ref
  pattern the other tile callbacks use (`handlers.current`), or the memoised
  tiles will re-render on every parent render. That file has already paid for
  this lesson twice, at 46ms and 67ms per keystroke.

---

## Tests

Follow the existing naming. Unit tests are `tests/unit/*.test.ts`, component
tests `tests/component/*.test.tsx`, e2e `tests/e2e/NN-name.spec.ts`.

**`tests/unit/storefront-rotation.test.ts`** (new)

- `normalizeRotation` folds 370, -370, 540 and 180.5 into range as whole ints.
- `withRotation` deletes the key at 0, returns the same object reference when
  the angle is unchanged, and never mutates its input.
- `angleFromCenter` for the four cardinal directions.
- `snapAngle` at the detents and at the midpoints between them.
- `toLocalPoint` round-trips: rotating a point by `d` then by `-d` returns it.
- `edgesUnderPointer` with rotation: a point that hits the north edge of an
  unrotated rect hits the east edge of the same rect at 90 degrees.
- `edgeCursor` returns `ew-resize` for a north edge at 90 degrees.

**`tests/unit/validation-storefront.test.ts`** (extend)

- A block with `rotation: 45` parses; `181`, `-181`, `45.5` and `"45"` are
  rejected.
- A config with no `rotation` key anywhere round-trips byte-identically, which
  is the legacy-config guarantee.

**`tests/component/placement-section.test.tsx`** (new)

- The slider reflects an existing rotation and reports "0 degrees" when absent.
- The 0 button clears rather than writes zero (assert the patch, not the render).
- A multi-selection with different angles renders a mixed state rather than
  silently showing the first block's value.

**`tests/component/storefront-tile-style.test.tsx`** (extend)

- A block with `rotation: 30` renders a cell carrying `rotate: 30deg`, and a
  block without one carries no `rotate` property at all.

**`tests/e2e/23-rotation.spec.ts`** (new)

- Drag the handle and assert the committed angle in the panel readout.
- Shift-drag lands exactly on a 15 degree detent.
- `Alt+Right` with the tile focused nudges by 1 degree and does not navigate
  the browser back.
- Save, reload, and the angle survives.
- Run the existing axe helper on the editor with a rotated block selected.
  Remember the gotcha in `tests/e2e/a11y`: settle opacity before scanning, or a
  mid-fade element invents contrast failures.

---

## Verification before you hand off

Unit tests passing is **not** the bar. The db and e2e suites cannot run on this
machine (Device Guard blocks `postgres.exe`), so browser verification against
the dev server is the real check.

1. Start the dev server and open the editor at `localhost` (never `127.0.0.1`,
   which Next 16 blocks so the page never hydrates). If real routes 404, clear
   `.next`: a build run while dev was running, or a force-killed dev server,
   poisons that cache.
2. Rotate a product tile, a text tile, a shape and an image element. Confirm the
   whole tile turns, including its border, ring and control chip.
3. With a tile rotated to 40 degrees: drag it and confirm it tracks the cursor
   in screen space, not off at an angle. This is the `translate` fix and it is
   the single most likely thing to be wrong.
4. Grab each edge of a rotated tile and confirm the resize starts from the edge
   you actually grabbed, and that the cursor matches.
5. Marquee across a rotated tile, and confirm it selects.
6. Zoom to 25 percent and to 200 percent and repeat steps 3 and 4. The gesture
   math derives its scale from the grid rect, so a zoom bug shows up here.
7. Save, reload, confirm persistence. Then look at the storefront's card in the
   list at `/storefront`, which renders through `StorefrontPreview`, and confirm
   the miniature is tilted too.
8. Add a rotated board to the `/dev/storefront-preview` gallery so the read-only
   render has a permanent fixture.
9. Toggle Reduce Motion at the OS level and confirm nothing animates that
   should not.

State plainly in the handoff which of these you did, and name anything that
stayed unverified.

---

## Do not do these

- Do not put rotation inside `transform`. See "The transform collision".
- Do not rotate in the carousel or the masthead.
- Do not change the non-overlap rule, the reflow, or `readingOrder`. Rotation is
  visual and those three read the unrotated box on purpose.
- Do not add rotation to `CardStyleOverrides`. Card style is theme defaults with
  per-tile exceptions, and rotation has no meaningful storefront-wide default.
- Do not write `rotation: 0`. Ever. Use `withRotation`.
