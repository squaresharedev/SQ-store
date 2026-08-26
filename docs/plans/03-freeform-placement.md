# Prompt 3 of 3: Freeform placement

Let a seller choose between the snap-to-grid board they have today and a free
canvas where blocks sit at any position, at any size, overlapping as they like.

This is the third of three prompts that turn the storefront canvas into a
freeform design surface:

1. **Rotation** (`01-block-rotation.md`)
2. **Layering** (`02-block-layering.md`)
3. **Freeform placement** (this document)

**Depends on prompts 1 and 2 being merged.** Free placement without rotation is
half a feature, and free placement without layering has no answer to "which of
these two overlapping blocks is in front".

This is the largest of the three. Read the whole document before writing code:
several decisions here are load-bearing and only make sense together.

---

## Before you write anything

Read `AGENTS.md`, `docs/styles.md`, the top-of-file comment in
`src/types/storefront.ts`, the `CANVAS MODEL` comment at line 68 of that file,
`src/components/grid/gridConstants.ts`, and the `.ss-grid` rule in
`src/app/globals.css`. The same house rules apply:

- **No em dashes** anywhere.
- Comments explain *why*, not *what*.
- Optional config fields are dropped when they equal the default.
- The published schemas package is the canonical contract
  (`docs/agent-surface.md`). This prompt changes the shape of the placement
  fields themselves, so the mirror and the version bump are not optional.

---

## The core decision: one coordinate system, not two

Free mode keeps **cell units**. It does not introduce normalized 0..1
coordinates or pixels.

`x`, `y`, `w` and `h` stay exactly what they are today: a position and a span
measured in board cells on a `columns` by `rows` board. The only change is that
in free mode they may be **fractional**, and in grid mode they must stay whole.

This buys three things that a second coordinate vocabulary would have cost:

- **Switching to free mode is a no-op on the data.** Every existing block is
  already a valid free-mode block. There is nothing to migrate and nothing to
  get wrong.
- **Free mode reproduces grid geometry exactly at integer coordinates.** The
  layout formula below is derived from the `.ss-grid` square-cell math, so a
  board switched to free mode is pixel-identical until the seller moves
  something. Nothing jumps at the moment of the switch, which is the single
  worst thing a mode toggle can do.
- **Every existing helper keeps working.** `findFreeCell`, `packFirstFit`,
  `reflowBlocks` and `placementIsFree` stay integer-only and stay in use for
  grid mode and for the free-to-grid conversion.

---

## The model change

### `src/types/storefront.ts`

```ts
/** How blocks are positioned on the board: snapped to whole cells with no
 *  overlap, or placed freely at any position and size. Absent = "grid", so a
 *  config saved before free placement existed parses and renders unchanged. */
export const PLACEMENT_MODES = ["grid", "free"] as const;
export type PlacementMode = (typeof PLACEMENT_MODES)[number];

/** Decimal places a free coordinate is stored to. Three is finer than a pixel
 *  at any cell size the board can render, and it keeps the stored JSON short
 *  and diffable. */
export const PLACEMENT_PRECISION = 3;

/** Smallest span a free block may take, in cells. Below roughly this a tile
 *  has no room for its own content and becomes impossible to grab again. */
export const PLACEMENT_MIN_SPAN = 0.25;

/** Round a free coordinate to the stored precision. EVERY writer goes through
 *  this, so a value that reaches the schema can never be rejected for having
 *  drifted into float noise during a drag. */
export function quantizeCell(value: number): number;

/** Is this placement whole-celled, as grid mode requires? */
export function isGridAligned(placement: BlockPlacement): boolean;
```

Add to `StorefrontTheme`:

```ts
/** Grid or free placement. Absent = "grid" (see PLACEMENT_MODES). */
placementMode?: PlacementMode;
```

Optional, not defaulted into `DEFAULT_STOREFRONT_CONFIG`, so a new storefront
and one saved a year ago are the same config.

Update the `CANVAS MODEL` block comment at the top of the file. It currently
asserts "Placements are always non-overlapping and inside the canvas". That is
now conditional and the comment is the first place a reader will look.

### `src/lib/validation/storefront.ts`

The field-level bounds relax to absolute limits; the mode-specific rules move
into the config-level `superRefine`, which is where the existing canvas
invariants already live because they span theme and blocks.

```ts
/** A coordinate in cells. Fractional values are legal here and are narrowed to
 *  whole cells by the config-level refinement when the board is in grid mode:
 *  a placement field cannot see theme.placementMode, and duplicating the mode
 *  onto every block to make it visible would be a worse trade. */
const cellUnit = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => quantizeCell(v) === v, {
      error: "A placement must be given to three decimal places.",
    });

const placementFields = {
  x: cellUnit(0, CANVAS_COLUMNS_MAX),
  y: cellUnit(0, CANVAS_ROWS_MAX),
  w: cellUnit(PLACEMENT_MIN_SPAN, CANVAS_COLUMNS_MAX),
  h: cellUnit(PLACEMENT_MIN_SPAN, CANVAS_ROWS_MAX),
  rotation: ...,  // from prompt 1
  z: ...,         // from prompt 2
};
```

In the config-level `superRefine`, replace the current body with a mode switch:

- **Both modes:** every block sits inside the board
  (`block.x + block.w <= columns`, same for rows). Keep rejecting rather than
  repairing, for the reason already written there: silently moving a block would
  scramble a layout the seller can see.
- **Grid mode only:** every placement is whole-celled (`isGridAligned`), and no
  two blocks overlap. Both keep their current messages.
- **Free mode:** neither. Overlap is the feature.

Add `placementMode: z.enum(PLACEMENT_MODES).optional()` to
`themeObjectSchema`. It is a `strictObject`, so this is required for the field
to survive a save at all.

### Presets

`src/lib/storefront/presets.ts` says its presets are validated unchanged by the
schema. Re-check them after the change and, if any preset should ship as a free
board, say so explicitly rather than letting it inherit the default.

### The embed payload

`src/app/api/embed/[key]/route.ts`: `config.theme` already travels whole, so
`placementMode` rides along with no code change. Confirm that in the comment
there rather than assuming it.

The widget is a separate consumer and **must** implement the free layout before
this ships, or a free board will render as a grid in every embed. Treat the
schemas package bump as the coordination point and write the layout formula
below into its docs.

---

## Layout

### The formula

In grid mode, `.ss-grid` gives square cells sized off the container:

```
cell  = (100cqw - (cols - 1) * gap) / cols
```

Free mode uses the same cell, and places on the same **pitch**:

```
pitch = cell + gap
left  = x * pitch
top   = y * pitch
width  = w * pitch - gap
height = h * pitch - gap
```

At integer coordinates this is algebraically identical to what CSS grid
produces (`w * cell + (w - 1) * gap`), which is what makes the mode switch
invisible. At fractional coordinates it degrades smoothly, and the `- gap` term
keeps a free block the same size as the grid block it came from rather than
silently absorbing the gutter.

### The CSS

Add to `src/app/globals.css`, next to the `.ss-grid` rule and sharing its
variables. Keep it beside `.ss-grid` so the two layouts are read together:

```css
/* Free placement: the same square-cell pitch as .ss-grid, computed rather
   than delegated to CSS grid, so coordinates can be fractional and blocks can
   overlap. At whole-cell coordinates it lays out identically to .ss-grid,
   which is what makes switching modes visually lossless. */
.ss-free {
  --ss-cell: calc(
    (100cqw - (var(--ss-cols, 6) - 1) * var(--grid-gap)) / var(--ss-cols, 6)
  );
  --ss-pitch: calc(var(--ss-cell) + var(--grid-gap));
  position: relative;
  height: calc(var(--ss-rows, 1) * var(--ss-pitch) - var(--grid-gap));
}
.ss-free > * {
  position: absolute;
  left: calc(var(--b-x) * var(--ss-pitch));
  top: calc(var(--b-y) * var(--ss-pitch));
  width: max(1px, calc(var(--b-w) * var(--ss-pitch) - var(--grid-gap)));
  height: max(1px, calc(var(--b-h) * var(--ss-pitch) - var(--grid-gap)));
  /* Same per-cell isolation .ss-grid children get, and the same reason: each
     block is its own stacking context, so its chrome cannot escape it. */
  contain: layout style;
}
```

`100cqw` resolves against `.ss-grid-container`, which already carries
`container-type: inline-size` and already wraps the board. The `max(1px, ...)`
guard is for the pathological case of a minimum-span block at the maximum gap.

Per-block values arrive as inline custom properties (`--b-x`, `--b-y`, `--b-w`,
`--b-h`) as **unitless numbers**, multiplied by a length inside `calc`. They are
schema-bounded numbers, never user text, so this stays inside the config
contract's "no free-form CSS" rule for the same reason `gridGapStyle` does.

### `src/components/grid/Grid.tsx`

Add one prop rather than a second component:

```ts
/** How blocks are positioned. "grid" delegates to CSS grid and honours whole
 *  cells only; "free" places each block absolutely on the same pitch and
 *  allows fractional coordinates and overlap. */
layout?: "grid" | "free";
```

One component because the grid is the shared, presentation-agnostic primitive
that the marketplace reuses later, and because `renderBlock`, `cellStyle`,
`getBlockLabel`, `editable` and every gesture are identical in both modes. Only
the positioning math and three behaviours differ.

In free mode:

- Root class is `GRID_ROOT_FREE_CLASS` (`"ss-free"`) instead of
  `GRID_ROOT_CLASS`, still inside `GRID_CONTAINER_CLASS`.
- Each block gets the four `--b-*` custom properties instead of
  `placementStyle`'s `gridColumn`/`gridRow`.
- **Reflow is off.** `responsive` is ignored, the `ResizeObserver` is not
  attached, `reflowBlocks` is not called. Free coordinates cannot be repacked
  without destroying the design, which is exactly the trade this mode makes.
  See "Small screens" below for what replaces it.
- Empty cells become a **lattice**, not 120 buttons. Draw the cell grid as a
  `repeating-linear-gradient` background on the board when `showEmptyCells` is
  on. It is one paint instead of hundreds of elements, and in free mode the
  cells are a guide rather than a set of insert targets.
- `onEmptyCellClick` fires from a click on the board background, with the
  **fractional** cell coordinates under the pointer. Document the widened
  contract on the prop.

Put the free-mode math in a new `src/components/grid/freeLayout.ts` next to
`gridConstants.ts`, pure and unit-testable:

```ts
export function freeBlockVars(placement: GridPlacement): CSSProperties;
export function pointToCell(
  boardRect: DOMRect,
  pitchPx: number,
  point: { x: number; y: number },
): { x: number; y: number };
export function clampFree(
  placement: GridPlacement,
  columns: number,
  rows: number,
): GridPlacement;
```

---

## Gestures

`readStrides()` already returns `strideX` and `strideY`, which **are** the pitch.
That is the whole conversion between screen pixels and cell units, at any zoom,
and it means the free gestures are the existing ones minus the rounding.

### Move

`startMove`'s candidate becomes, in free mode:

```ts
const candidate = clampFree(
  {
    ...origin,
    x: quantizeCell(origin.x + dx / strides.strideX),
    y: quantizeCell(origin.y + dy / strides.strideY),
  },
  columns,
  rows,
);
```

with `Math.round` gone and `placementIsFree` not consulted, since overlap is
legal. A free drag always commits: there is no invalid drop and therefore no
spring-back, so the `data-valid` styling and the snap ghost are grid-mode only.

### Resize

Same change: continuous instead of cell-snapped, floored at
`PLACEMENT_MIN_SPAN` instead of one cell. Both `startEdgeResize` and
`startResize` keep their existing pinned-edge logic, which is already expressed
in board space and needs no restructuring.

Add `Shift` to preserve the aspect ratio during a resize, which is the universal
binding and is currently unused during that gesture.

### Rotation-compensated resize

Prompt 1 left this open with a comment. Resolve it here.

When a rotated block is resized, its centre moves, and because the rotation is
about the centre the edge the seller is pinning appears to swing. Compensate by
translating the block so the anchor point stays fixed in **local** space:

```
offset = R(theta) * (newCenterLocal - oldCenterLocal) - (newCenter - oldCenter)
```

Apply it to `x` and `y` after computing the new placement, then `quantizeCell`.
This produces fractional coordinates, which is why it could not land before
this prompt. Put it in `src/components/grid/rotationMath.ts` beside the helpers
prompt 1 added:

```ts
/** A resized placement adjusted so the pinned edge of a ROTATED block stays
 *  where the cursor left it. Grid mode cannot use this (the correction is
 *  sub-cell), so a rotated grid block stays anchored in board space. */
export function compensateRotatedResize(
  origin: GridPlacement,
  resized: GridPlacement,
  degrees: number,
): GridPlacement;
```

### Snapping

Free placement without snapping is unusable, and snapping that cannot be
switched off is worse. Put the logic in a pure module,
`src/lib/storefront/snapping.ts`:

```ts
export type GuideLine = { axis: "x" | "y"; at: number; from: number; to: number };

export type SnapResult = {
  x: number;
  y: number;
  guides: GuideLine[];
};

/** The nearest snap for a moving box, plus the guides to draw for it.
 *  Everything is in CELL units; `threshold` is the pixel tolerance already
 *  divided by the pitch, so the feel is constant at any zoom. */
export function snapPlacement(
  moving: GridPlacement,
  others: readonly GridPlacement[],
  board: { columns: number; rows: number },
  opts: { threshold: number; toCells: boolean },
): SnapResult;
```

Targets, in priority order when two are within tolerance:

1. The board's own edges and its horizontal and vertical centres.
2. Other blocks' left, centre and right edges (x), and top, middle and bottom
   edges (y).
3. The cell lattice, only when "snap to grid" is on.

`SNAP_PX = 6`, divided by the pitch in pixels before it is passed in. Holding
`Alt` during a drag suspends snapping entirely, which is the standard escape
hatch in every tool that has this.

Snap x and y independently. A block that is aligned horizontally with one
neighbour and vertically with another is the common case and a combined
nearest-point search gets it wrong.

### The guide overlay

Draw the guides the way `DesignerCanvas` already draws the marquee rubber band:
a small set of absolutely positioned 1px elements, positioned by direct style
writes inside the gesture's existing `requestAnimationFrame`, never through
React state. A 60Hz drag must cost zero re-renders, which is the standard the
rest of this canvas already holds itself to.

Chrome: 1px, `bg-ring`, `pointer-events-none`, at `OVERLAY_Z` from the band
prompt 2 defined in `gridConstants.ts`.

### Nudging

In free mode, plain arrow keys nudge by `NUDGE_STEP = 1 / 24` of a cell (4px at
the design cell size) instead of moving a whole cell. `Shift` + arrows stays
resize, unchanged, so no existing binding moves and no new one is needed.

### Paste

`pasteBlocks` currently finds a free cell for each pasted block. In free mode
there is no such thing, so paste offsets by `PASTE_OFFSET = 0.5` cells down and
right of the source, clamped into the board. This is what every design tool
does and it is what makes "paste, nudge, paste, nudge" work.

---

## Small screens

This is the honest cost of free placement and it must be stated in the UI, not
buried.

Grid mode reflows: below the width where cells stay legible it abandons
coordinates and repacks into fewer columns (`reflowBlocks`). Free mode cannot,
because a repacked freeform composition is not that composition any more. So
free mode **scales the whole board instead**.

- Read-only renders (`StorefrontPreview`, the buyer page, the embed widget) lay
  a free board out at a fixed design width (`columns * DESIGN_CELL_PX` plus
  gaps) and scale it to the container with `transform: scale(...)`. This is
  exactly what `useFitToBox` already does for preview cards, so reuse the hook
  rather than writing a second one.
- Text scales with everything else, which is the point. If the board only shrank
  its cells (which the container query would do on its own) the px-sized text
  would grow proportionally huge and the design would break.
- `MIN_BOARD_SCALE = 0.35`. Below that, stop scaling and let the board scroll
  horizontally inside its container, rather than rendering something nobody can
  read.
- The designer's mobile preview mode currently renders fluid so the seller sees
  the real reflow. In free mode there is no reflow, so it renders the scaled
  board instead. The preview must show what will actually happen.

Put a plain sentence in the panel next to the mode switch, in `infoTextClass`:

> Free placement does not rearrange itself on phones. The whole storefront
> scales down instead, so keep text large enough to survive it.

---

## Clipping and the board edge

In free mode a block can sit at the board edge, and a rotated one can spill past
it. The board's background stops at the frame, so unclipped spill paints a block
onto the page around the storefront.

- **Read-only renders clip.** `overflow: clip` on the board in
  `StorefrontPreview` and in the buyer render. The storefront ends where its
  background ends.
- **The editor does not clip.** It cannot: `TileImageFramer`'s ghost spills past
  a tile deliberately, and the resize and rotate handles sit in the cell's outer
  corners. Clipping the editor frame would cut all three off for any block near
  the edge.

That is a real divergence between the editor and the buyer view, and this
codebase is otherwise strict about not having one, so pay for it with an
affordance rather than a comment: when a selected block's box extends past the
board, `PlacementSection` shows an "Outside the canvas" note with a button that
pulls it back inside. The seller is told, in the one place they are already
looking.

---

## Switching modes

### Grid to free

Identity. No data changes, nothing moves, no confirmation. Just set
`theme.placementMode = "free"`. The layout formula guarantees the board looks
the same on the next frame.

### Free to grid

Lossy, so it confirms first. Put the conversion in
`src/lib/storefront/placement-modes.ts`:

```ts
/** Every block rounded onto whole cells and separated so none overlap.
 *
 * Position is preserved wherever it can be: a block whose rounded spot is
 * free simply stays there, and only the ones that then collide are moved, in
 * layer order so the block in front keeps the spot it was painted in. That is
 * a far smaller change to the seller's design than repacking the whole board,
 * which is what tidyBlocks is for and what they can still ask for by hand.
 */
export function freeToGrid(
  blocks: StorefrontBlock[],
  columns: number,
  rows: number,
): { blocks: StorefrontBlock[]; rows: number; moved: number };
```

Algorithm: round each block (spans floored at 1 cell, clamped into the board),
then walk them in layer order, keeping each in its rounded spot when
`placementIsFree` says it is clear and otherwise sending it to `findFreeCell`,
growing rows up to `CANVAS_ROWS_MAX` if the board fills. Return how many blocks
had to move so the confirmation can say.

Rotation and z survive both directions untouched.

The confirmation uses the existing `Modal` component and says what will actually
happen, with the count: "4 blocks will move to fit the grid." One `recordChange`
for the whole conversion, so a mistaken switch is one undo.

### The control

`src/components/storefront/LayoutSection.tsx`. Add a `SegmentedControl` above
"Display mode", matching how `DISPLAY_MODE_OPTIONS` is built:

```ts
const PLACEMENT_MODE_OPTIONS: readonly { value: PlacementMode; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "free", label: "Free" },
];
```

Label it "Placement". Below it, help text explaining the difference in one line
each, plus the small-screen sentence from above when free is selected.

While in free mode, "Grid density" still applies (it is the pitch, and it is
what keeps the two modes aligned), but relabel its help text so it does not read
as dead. "Show grid" becomes the lattice toggle and keeps its name.

---

## Panel additions

Extend `src/components/storefront/PlacementSection.tsx`, built in prompt 1 and
extended in prompt 2. In free mode it gains:

- **Position and size**, four numeric fields (X, Y, W, H) in cells, to two
  decimals, using the existing numeric field pattern rather than a new control.
  Typing an exact value is the reason a freeform tool feels precise rather than
  approximate.
- **Align**, six icon buttons for a multi-selection: left, horizontal centre,
  right, top, middle, bottom. Aligning to the selection's own bounding box.
- **Distribute**, two buttons: horizontal and vertical, enabled at three or more
  blocks.
- The "Outside the canvas" note described above.

Put the align and distribute math in `src/lib/storefront/align.ts` as pure
functions over `BlockPlacement[]`, for the same reason the layer operations are
pure: they are testable without a DOM and reusable by the agent surface later.

Grid mode hides the numeric fields (whole cells are already what the drag gives)
but keeps align and distribute, which work there too.

---

## Everything else that has to change

Work through this list rather than trusting a grep:

- **`StorefrontDesigner.findSpot`** gains a free branch: the click point is the
  spot, with no collision search and no row growth.
- **`StorefrontDesigner.tidyBlocks`** in free mode aligns every block to the
  nearest cell **without** leaving free mode. The toolbar label becomes "Snap to
  grid" in that mode.
- **`StorefrontDesigner.updateCanvas`** computes its minimum columns and rows
  from `Math.ceil(block.x + block.w)`, or shrinking the board past a fractional
  block will fail validation on save rather than being refused in the editor.
- **`readingOrder`** stays sorted by top-left, unchanged. Sorting overlapping
  free blocks by centre is tempting and is not worth the churn: top-left is
  stable, matches the DOM order the grid already produces, and is what the embed
  and screen readers already speak.
- **`CarouselStrip`** is unaffected. Carousel display mode abandons coordinates
  entirely, so it works the same in both placement modes. Note it beside the
  rotation and layering notes prompts 1 and 2 added.
- **`buyerVisibleBlocks`, `blockKey`, `blockCornerRadius`** are unaffected.
- **`scaledCornerRadius`** multiplies by `Math.min(w, h)`, which now takes
  fractions. Check that a 0.5-cell block does not round to nothing visible, and
  floor it if it does.
- **`saveStorefront`** needs no change: it re-parses with the same schema, which
  is the point of the mode rule living in `superRefine`.

---

## Tests

**`tests/unit/free-layout.test.ts`** (new)

- `freeBlockVars` emits the four custom properties as unitless numbers.
- `clampFree` keeps a block inside the board and respects
  `PLACEMENT_MIN_SPAN`.
- `pointToCell` round-trips against a synthetic board rect at scale 1 and at
  scale 2. The zoom case is the one that regresses.
- `quantizeCell` is idempotent, and a value it produced always passes the
  schema's precision refinement. Assert this against the real schema, since
  drift between the two is the failure that would only appear on save.

**`tests/unit/storefront-snapping.test.ts`** (new)

- Snaps to a neighbour's left edge inside the threshold and not outside it.
- Snaps x and y to two different neighbours in one call.
- Board centre wins over a block edge at equal distance.
- `toCells: false` never returns a lattice snap.
- Returns the input position unchanged, and no guides, when nothing is near.

**`tests/unit/placement-modes.test.ts`** (new)

- `freeToGrid` leaves an already-aligned, non-overlapping board completely
  untouched and reports `moved: 0`.
- Two overlapping blocks: the one in front keeps its spot, the one behind moves.
- Rotation and z survive the conversion.
- A board that no longer fits grows rows, and stops at `CANVAS_ROWS_MAX`.

**`tests/unit/validation-storefront.test.ts`** (extend)

- Grid mode rejects `x: 1.5` and rejects two overlapping blocks, with the
  existing messages.
- Free mode accepts both.
- Both modes reject a block that leaves the board.
- `w: 0.1` is rejected in both modes (`PLACEMENT_MIN_SPAN`).
- A config with no `placementMode` round-trips byte-identically.

**`tests/unit/align.test.ts`** (new) for the align and distribute math.

**`tests/component/free-canvas.test.tsx`** (new)

- A free board renders `.ss-free` and per-block `--b-*` properties.
- A grid board still renders `.ss-grid` with `gridColumn`/`gridRow`.
- At integer coordinates both modes emit the same effective geometry. Assert the
  computed pitch arithmetic, since this is the "nothing jumps on switch"
  guarantee and it is the thing most likely to rot.

**`tests/component/placement-section.test.tsx`** (extend)

- Numeric fields appear only in free mode and write quantized values.
- Align buttons need two blocks, distribute needs three.
- The "Outside the canvas" note appears for an overhanging block and its button
  pulls the block back.

**`tests/e2e/25-freeform.spec.ts`** (new)

- Switch to free mode and assert nothing moved: capture each block's box before
  and after.
- Drag a block to a fractional position, save, reload, and it is still there.
- Drag near a neighbour's edge and assert the snap plus the guide.
- Hold `Alt` and confirm no snap.
- Overlap two blocks and confirm both render (grid mode would have refused).
- Switch back to grid, confirm the modal, accept, and assert everything is
  whole-celled and non-overlapping.
- Undo the conversion in one step.
- Run the axe helper on a free board, remembering the settle-the-opacity gotcha
  in `tests/e2e/a11y`.

---

## Verification before you hand off

The db and e2e suites cannot run on this machine (Device Guard blocks
`postgres.exe`), so browser verification against the dev server is the real
check. Use `localhost`, never `127.0.0.1`. If routes 404, clear `.next`.

Build a `/dev/storefront-freeform` gallery page first, following the pattern of
`/dev/storefront-preview`. It is the only durable way to check the read-only
renders on this machine, and it outlives this task. Fixtures: a grid board, the
same board in free mode, a free board with rotation and deliberate overlap, a
free board with a block hanging off the edge, and each at a few container
widths.

Then, in the editor:

1. Switch a real board from grid to free and confirm **nothing moves**. This is
   the headline guarantee. Screenshot before and after if it helps.
2. Drag a block to a fractional position, overlapping a neighbour. Confirm it
   commits (no spring-back) and that layering decides which is in front.
3. Check the snapping: to a neighbour's edge, to a neighbour's centre, to the
   board centre, to the lattice with "Show grid" on. Hold `Alt` and confirm it
   stops.
4. Resize a **rotated** block from each edge and confirm the pinned edge stays
   put. This is `compensateRotatedResize` and it is the most likely thing to be
   subtly wrong.
5. Zoom to 25 percent and 200 percent and repeat steps 2, 3 and 4.
6. Nudge with the arrows, then `Shift`+arrows, and confirm the first moves and
   the second resizes.
7. Copy and paste a block and confirm the 0.5-cell offset.
8. Save, reload, and confirm every fractional value survived. Then look at the
   card on `/storefront` and confirm the miniature matches.
9. Resize the browser down to phone width with the free board open in mobile
   preview. Confirm it scales rather than reflows, and that it stops scaling at
   the floor instead of becoming unreadable.
10. Switch back to grid, read the modal's count, accept, and confirm the result
    is a legal grid board. Undo and confirm one step restores the free layout.
11. Save a free board and fetch its embed payload from
    `/api/embed/[key]` with an allowed origin. Confirm `placementMode`,
    fractional coordinates, `rotation` and `z` are all present.

Say plainly which of these you did and name anything left unverified. In
particular, if the embed widget has not been updated to render free boards, say
so: that is the one part of this feature that lives outside this repo.

---

## Do not do these

- Do not introduce a second coordinate system. Cell units, fractional in free
  mode. See "The core decision".
- Do not make free mode reflow. Repacking a freeform composition destroys it.
- Do not drop the `- gap` term from the width formula. It is what keeps the two
  modes the same size.
- Do not let the free layout be measured in JavaScript. The formula is pure CSS
  on top of variables that already exist, so it is correct at any zoom, any
  container width, and during a pan, for free.
- Do not route snap guides or drag previews through React state.
- Do not remove `reflowBlocks`, `packFirstFit` or `findFreeCell`. Grid mode and
  the free-to-grid conversion both still need them.
- Do not ship this without the schemas package bump and a note to whoever owns
  the embed widget.
