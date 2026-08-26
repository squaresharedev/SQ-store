# Prompt 2 of 3: Block layering

> **Superseded in two places, deliberately, after this shipped.** Freeform
> placement (prompt 3) is out of the MVP, so the two features below had to
> carry its weight on their own:
>
> 1. **Blocks may overlap.** The schema's non-overlap refinement is gone and
>    the canvas passes `allowOverlap` to the grid, so a drop onto an occupied
>    cell lands there. "Do not change `placementsOverlap` and the config-level
>    non-overlap refinement" below no longer applies; the function survives as
>    the question an auto-placer asks, not as a rule.
> 2. **Rotation changes which way round a block's cells lie.** `blockFootprint`
>    derives them (`lib/geometry/rotated-box.ts`) by transposing the block's own
>    rect about its centre: same number of cells, no move, no resize. `x/y/w/h`
>    stay the unrotated rect.
>
> Everything else here still holds, `z` and `layerOrder` included.

Give every storefront block an explicit stacking order, with front/back
controls in the design panel, keyboard shortcuts, and a z-index band that
cannot collide with the editor's own chrome.

This is the second of three prompts that turn the storefront canvas into a
freeform design surface:

1. **Rotation** (`01-block-rotation.md`)
2. **Layering** (this document)
3. **Freeform placement** (`03-freeform-placement.md`)

**Depends on prompt 1 being merged.** Not for the code, but for the reason: a
board whose blocks cannot overlap has nothing to stack. Rotation is what first
makes two blocks paint over each other, and freeform placement is what makes it
routine. Landing layering between them means prompt 3 arrives to a canvas that
already knows what is in front.

---

## Before you write anything

Read `AGENTS.md`, `docs/styles.md`, the top-of-file comment in
`src/types/storefront.ts`, and `src/components/grid/Grid.tsx`. The same house
rules apply as in prompt 1:

- **No em dashes** anywhere.
- Comments explain *why*, not *what*.
- Optional config fields are dropped when they equal the default, so an
  untouched block stays byte-identical to one saved before the field existed.
- The published schemas package is the canonical contract
  (`docs/agent-surface.md`). Mirror every schema edit into it and bump the
  version.

---

## The design decision that shapes everything else

**Stacking order is visual only. DOM order stays reading order.**

The blocks array is rendered top-to-bottom, left-to-right
(`readingOrder` in `src/types/storefront.ts`), and that is what a screen reader
walks, what the embed payload serializes, and what the carousel display mode
turns into a strip. Layering must not touch any of it. A seller who sends a
decorative shape behind a product tile has said something about paint order, not
about which one a blind buyer should hear about first.

So: `z` drives the `z-index` CSS property and nothing else. Write this as a
comment on the type, because it is the kind of decision a later reader will
otherwise "fix".

---

## The model change

### `src/types/storefront.ts`

Add to `BlockPlacement`, beside the `rotation` field prompt 1 introduced:

```ts
/**
 * Paint order, 0 (furthest back) to MAX_BLOCKS - 1. Absent means the block
 * has never been layered and simply paints in reading order, which is how
 * every board rendered before overlap was possible.
 *
 * VISUAL ONLY. DOM order stays reading order (see readingOrder), so screen
 * readers, the embed payload and the carousel are all unaffected by which
 * block is in front.
 *
 * Layering operations rewrite z on EVERY block at once (see layerOrder), so
 * a board is either entirely unlayered or entirely layered. A half-layered
 * board would have no total order and "bring forward" would have no answer.
 */
z?: number;
```

Add one resolver:

```ts
/**
 * The blocks in paint order, back to front.
 *
 * An unlayered board falls back to reading order, which is exactly what the
 * DOM already gave it, so a config saved before layering renders unchanged.
 */
export function layerOrder<T extends BlockPlacement>(blocks: T[]): T[];
```

Implement it as: if no block carries `z`, return `readingOrder(blocks)`.
Otherwise sort by `z ?? readingIndex`, ties broken by reading index. The tie
rule matters for the one frame between a paste and the next normalize.

### `src/lib/storefront/layers.ts` (new)

Pure functions, no React, no DOM, so they are unit-testable and reusable by the
future agent surface:

```ts
/** Every block given a dense z, 0..n-1, back to front. The one writer of z. */
export function normalizeLayers(blocks: StorefrontBlock[]): StorefrontBlock[];

export function bringToFront(blocks, keys: readonly string[]): StorefrontBlock[];
export function sendToBack(blocks, keys: readonly string[]): StorefrontBlock[];
export function bringForward(blocks, keys: readonly string[]): StorefrontBlock[];
export function sendBackward(blocks, keys: readonly string[]): StorefrontBlock[];
```

Rules all four share:

- They operate on the order `layerOrder` gives, then hand the result to
  `normalizeLayers`, so z is always dense and small. Sparse or drifting z values
  are how a layering model ends up needing a migration.
- A multi-selection **keeps its own relative order**. "Bring to front" on three
  blocks moves all three to the top as a contiguous run, in the order they were
  already in. This is the single most-noticed correctness detail in a layer
  system, and the easy implementation (map each key independently) gets it
  wrong.
- `bringForward` on a block already at the front is a no-op and must return the
  **same array reference**, so the caller can skip recording an undo step.
- Dense normalization means the first layering operation writes `z` to every
  block on the board. That is one intentional, one-time diff, and it is the
  price of a total order. Say so in the module comment.

### `src/lib/validation/storefront.ts`

One line in `placementFields`:

```ts
z: z.number().int().min(0).max(MAX_BLOCKS - 1).optional(),
```

`MAX_BLOCKS` is already defined in that file (120). No config-level refinement:
a board with duplicate or gapped z values still has a well-defined paint order
via the tie rule, and rejecting a save over it would be a validation error the
seller cannot act on.

### The embed payload

`src/app/api/embed/[key]/route.ts`, the `placement` object in `publicBlocks()`,
alongside the `rotation` spread from prompt 1:

```ts
...(block.z !== undefined ? { z: block.z } : {}),
```

The widget needs it: `publicBlocks` maps over `readingOrder(blocks)`, so DOM
order in the widget is reading order and the paint order has to travel as data.

---

## The z-index band

This is the part that will break quietly if it is not done deliberately.

Block z-indexes now compete with the editor's own chrome inside the same
stacking context. Audit before you write:

- `.ss-grid > *` carries `contain: layout style` (see `globals.css`), which
  makes **each cell its own stacking context**. So everything inside a tile
  (`BlockTile`'s control chip at `z-20`, `ProductTileContent`'s badges at
  `z-10`, `TileImageFramer` at `z-30`) is safely scoped and needs no change.
- The cells themselves are siblings, so their z-indexes are compared in the
  nearest stacking-context ancestor. In the designer that is the stage element
  in `DesignerCanvas`, which creates one via `willChange: transform`.
- Competing in that same context today: the marquee rubber band (`z-40` in
  `DesignerCanvas`), the framing lift (`zIndex: 30`, also `DesignerCanvas`), and
  the grid's own gesture lifts (`z-30` and `z-10` classes on the cell in
  `Grid.tsx`).

Define the band once, in `src/components/grid/gridConstants.ts`, and make every
one of those call sites read from it:

```ts
/**
 * Paint order bands for the canvas, in ONE place because they share a
 * stacking context: grid cells are siblings, and each cell's own contents are
 * already isolated by `contain: layout` (see .ss-grid in globals.css).
 *
 * Content sits at the bottom so a board can never stack a block over the
 * editor's own affordances, however many blocks it has.
 */
export const LAYER_Z_BASE = 1;          // block z 0..MAX_BLOCKS-1 maps here
export const LAYER_Z_CEILING = 500;     // nothing content-driven above this
export const GESTURE_Z = 600;           // a tile under drag or resize
export const FRAME_Z = 600;             // a tile whose image is being framed
export const OVERLAY_Z = 700;           // marquee band, snap guides
```

Then:

- `Grid.tsx` cell style: `zIndex: LAYER_Z_BASE + effectiveZ`. Replace the
  `z-30` and `z-10` Tailwind classes on the cell with `GESTURE_Z` written
  inline, so the lift is always above every block instead of above the first
  thirty.
- `DesignerCanvas.tsx`: the framing lift becomes `FRAME_Z`; the marquee band's
  `z-40` becomes `OVERLAY_Z`.
- Leave the toolbar (`z-40`), the panels (`z-30`/`z-40`) and modals (`z-50`)
  alone. They are `fixed` elements outside the stage's stacking context and the
  comment in `EditorToolbar.tsx` already explains their relationship.

`StorefrontPreview` and the buyer render need the block z-index too, and have no
chrome to compete with. Same `LAYER_Z_BASE + effectiveZ`, applied in its
`cellStyle`.

### Where the effective z comes from

Both canvases already map blocks into grid blocks in a `useMemo`. Compute the
effective z there, once, into a `Map<key, number>` derived from `layerOrder`,
and read it in `cellStyle`. Do not call `layerOrder` inside `cellStyle`: it runs
per cell per render, and a 120-block board would sort 120 times per paint.

---

## The controls

### Panel

Extend `src/components/storefront/PlacementSection.tsx`, created in prompt 1.
Add a "Layer" group below Rotation:

- Four icon buttons in a row: send to back, send backward, bring forward, bring
  to front. Lucide icons `SendToBack`, `ChevronDown`, `ChevronUp`,
  `BringToFront`, at `size-4`, `strokeWidth={2}`.
- Each is a real `<button>` with an `aria-label` that names the action, not the
  icon.
- Disable "forward"/"to front" when everything selected is already at the front,
  and likewise at the back. A control that does nothing is worse than a disabled
  one.
- A readout on the right in `helpTextClass`: `"Layer 3 of 12"` for a single
  selection, `"3 blocks selected"` for a multi-selection.

Use `labelClass` and `helpTextClass` from `@/components/ui/control-styles`.
Match the button chrome already used for icon rows in the panel rather than
inventing a new one.

### Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `]` | bring forward |
| `Ctrl`/`Cmd` + `[` | send backward |
| `Ctrl`/`Cmd` + `Shift` + `]` | bring to front |
| `Ctrl`/`Cmd` + `Shift` + `[` | send to back |

These are the Figma and Illustrator bindings, so they are what a seller who has
used either will try first. On macOS `Cmd+[` and `Cmd+]` are also browser Back
and Forward, so `preventDefault()` is required.

Bind them in `StorefrontDesigner.tsx` on the same window listener the undo and
copy/paste shortcuts already use, and reuse **its** guards exactly:

- Skip while typing in a field (text inputs keep their own behaviour).
- Skip while a custom Select dropdown is open. That guard exists because the
  trigger is a button, not an input, and it is easy to forget.
- Skip when the selection is empty.

Read the live handler through the existing ref so the listener still subscribes
once and renders never churn `add`/`removeListener`.

### Designer wiring

Add one mutator beside the other key-list mutators in `StorefrontDesigner.tsx`
(around line 1630):

```ts
function reorderLayers(
  keys: readonly string[],
  op: "front" | "forward" | "backward" | "back",
): void;
```

It calls the matching function from `lib/storefront/layers.ts`, bails without
recording history when the result is the same array reference, and otherwise
calls `recordChange()` with **no coalesce key**. Repeated "bring forward"
presses are distinct intentions and each should be its own undo step, unlike a
slider drag.

---

## What must not change

- `readingOrder` and every caller of it.
- `publicBlocks`'s use of `readingOrder` to order the embed array.
- `placementsOverlap` and the config-level non-overlap refinement. Prompt 3 is
  what relaxes those; this prompt only decides who paints on top when they do
  overlap.
- `reflowBlocks`. The small-screen reflow repacks by reading order and is
  indifferent to z.
- `CarouselStrip`. A strip has no depth. Ignore z there, and say so in a
  comment beside the same note prompt 1 added about rotation.

---

## Tests

**`tests/unit/storefront-layers.test.ts`** (new)

- `layerOrder` on an unlayered board equals `readingOrder`, element for element.
- `layerOrder` with mixed present and absent z is total and deterministic.
- `normalizeLayers` produces exactly `0..n-1` with no gaps and no duplicates.
- `bringToFront` on a three-block multi-selection puts all three at the top
  **in their existing relative order**. Assert the order, not just membership.
- `bringForward` on a block already at the front returns the same array
  reference.
- `sendBackward` past a neighbour, then `bringForward`, returns the original
  order. Round-tripping is what proves the swap logic.
- None of the five functions mutate their input.

**`tests/unit/validation-storefront.test.ts`** (extend)

- `z: 0` and `z: 119` parse; `-1`, `120`, `1.5` and `"3"` are rejected.
- A config with no `z` anywhere round-trips byte-identically.

**`tests/component/placement-section.test.tsx`** (extend, from prompt 1)

- The four buttons call the mutator with the right op.
- Front controls are disabled for a block already at the front.
- The readout says "Layer 3 of 12" for a single selection.

**`tests/component/storefront-tile-style.test.tsx`** (extend)

- A layered board renders cells whose z-index ordering matches `layerOrder`.
- Every rendered block z-index is strictly below `GESTURE_Z`. This is the test
  that stops a future 200-block board from painting over the drag lift.

**`tests/e2e/24-layering.spec.ts`** (new)

- Overlap two blocks (rotate one so they collide), send one back, and assert
  paint order from the computed z-index.
- `Cmd/Ctrl+]` with a block selected brings it forward and does not navigate the
  browser.
- Undo restores the previous order in one step.
- Save, reload, the order survives.
- Run the axe helper with a layered board on screen, remembering the settle-the-
  opacity gotcha in `tests/e2e/a11y`.

---

## Verification before you hand off

The db and e2e suites cannot run on this machine (Device Guard blocks
`postgres.exe`), so browser verification against the dev server is the real
check. Use `localhost`, never `127.0.0.1`. If routes 404, clear `.next`.

1. Rotate two overlapping blocks so the overlap is obvious, then walk one of
   them back and forward through the stack with both the panel buttons and the
   keyboard. Confirm the paint order changes and the panel readout follows.
2. Select three blocks, bring them to front, and confirm their relative order
   among themselves is unchanged.
3. Drag a block that is at the **back** of the stack. It must lift above
   everything while dragging and settle back to the bottom on release. This is
   the `GESTURE_Z` band and it is the most likely thing to be wrong.
4. Enter frame mode on a back-most product tile and confirm the spilling ghost
   paints above its neighbours.
5. Marquee-select across a stack and confirm the rubber band is drawn above
   every block.
6. Save, reload, confirm the order persists. Check the card on `/storefront`
   renders the same order through `StorefrontPreview`.
7. Add a layered, overlapping board to the `/dev/storefront-preview` gallery as
   a permanent fixture.

Say plainly which of these you did and name anything left unverified.

---

## Do not do these

- Do not reorder the `blocks` array to express depth. Array order is
  deliberately meaningless (`saveStorefront` says so), `publicBlocks` re-sorts
  it, and making it load-bearing would break both.
- Do not change DOM order to express depth. See the design decision at the top.
- Do not leave z sparse or unbounded. Normalize on every operation.
- Do not use Tailwind `z-*` classes for block depth. The band lives in
  `gridConstants.ts` so a future reader can see the whole thing at once.
