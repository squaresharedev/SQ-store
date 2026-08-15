# Shared pickers: DatePicker & ColorPicker

Two on-brand primitives that replace the native browser controls, plus the
`Popover` overlay they share. All chrome is tokens-only (styles.md); values the
ColorPicker selects are user data. Built without a calendar/color dependency —
full keyboard + ARIA parity is hand-implemented.

Files:

- `src/components/ui/Popover.tsx` — anchored overlay (desktop) / bottom sheet (mobile).
- `src/components/ui/DatePicker.tsx` — controlled single **and** range picker.
- `src/components/ui/Calendar.tsx` — the ARIA date grid (DatePicker sub-file).
- `src/components/ui/ColorPicker.tsx` — controlled strict-hex color picker.
- `src/components/ui/ColorArea.tsx` — saturation/brightness + hue surface (sub-file).
- `src/lib/format/calendar.ts` — timezone-safe date math + labels (pure).
- `src/lib/format/color.ts` — HSV↔hex math (pure, only emits `#rrggbb`).
- `src/components/storefront/ColorPanel.tsx` — the left-hand color chooser.
- `src/lib/theme/color-presets.ts` — the three fixed swatches.
- `src/lib/theme/standard-colors.ts` — the 3×10 standard grid.
- `src/lib/theme/color-palettes.ts` — the named preset palettes.
- `src/lib/theme/palette.ts` — `collectStorefrontColors` (pure).
- `src/lib/theme/recent-colors.ts` — in-memory recently-picked store.
- `src/lib/theme/color-target.ts` — `ColorTargetRef` + `resolveColorTarget` (pure).
- `src/lib/theme/color-context.tsx` — `ColorTargetProvider` + `useColorTarget`.

---

## Popover

```tsx
<Popover
  open={open}
  onOpenChange={setOpen}
  label="Choose date"            // dialog accessible name
  panelClassName="sm:w-[19rem]"  // desktop width; mobile is always full-width
  trigger={
    <button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      …
    </button>
  }
>
  {/* panel content */}
</Popover>
```

- Opens under the trigger on desktop, as a full-width bottom sheet on mobile
  (dimmed backdrop, scroll locked).
- Focus moves into the panel on open (to a `[data-autofocus]` element if any),
  is trapped with Tab/Shift+Tab, and returns to the trigger on close.
- Esc or any outside click/tap closes it.
- The consumer owns the trigger and its `aria-haspopup` / `aria-expanded`.

## DatePicker

```tsx
// Single
<DatePicker mode="single" value={iso} onChange={setIso} label="Ship date" max="2026-12-31" />

// Range (value shape matches the Orders filter)
<DatePicker
  mode="range"
  value={{ from: filters.dateFrom ?? null, to: filters.dateTo ?? null }}
  onChange={({ from, to }) => …}
  label="Date range"
/>
```

Props:

| Prop | Type | Notes |
|---|---|---|
| `mode` | `"single" \| "range"` | discriminates the value/onChange types |
| `value` | `string \| null` (single) · `{ from, to }` of `string \| null` (range) | ISO `YYYY-MM-DD` |
| `onChange` | matching setter | single closes on pick; range keeps open until **Done** |
| `min` / `max` | `string` (`YYYY-MM-DD`) | inclusive bounds; out-of-range days disabled |
| `label` | `string?` | optional field label |
| `placeholder` | `string?` | shown when empty |
| `id` | `string?` | trigger id for an external `<label htmlFor>` |

Keyboard (grid): ← → move a day, ↑ ↓ move a week, Home/End week edges,
PageUp/PageDown change month (**+Shift** = year), Enter/Space select, Esc close.
Roving tabindex; each day has an ARIA grid role + full-date label; the selected
day / range endpoints use the black `--primary` token, in-range days `--accent`.
A **Today** affordance jumps to and focuses today.

## ColorPicker

**There is exactly one color picker in the product.** Every field that chooses a
color renders this component, so accent, background, text and shape colors look
and behave identically. Do not build a second one, and do not hand-roll a swatch
grid beside it — add a prop here instead.

```tsx
// Required color
<ColorPicker label="Accent" value={theme.accent} onChange={(hex) => …} />

// Optional color: absent = follow the theme
<ColorPicker
  label="Color"
  value={block.color ?? themeColor}
  onChange={(color) => onUpdate({ color })}
  inherit={{
    label: "Theme color",
    value: themeColor,                          // what the tile renders while inheriting
    active: block.color === undefined,
    onSelect: () => onUpdate({ color: undefined }),
  }}
/>
```

Props:

| Prop | Type | Notes |
|---|---|---|
| `value` | `string` | strict `#rrggbb` |
| `onChange` | `(hex: string) => void` | only ever receives strict lowercase hex |
| `label` | `string?` | field label |
| `id` | `string?` | trigger id for an external `<label htmlFor>`; derive it from `useId()`, never a hardcoded string |
| `inherit` | `ColorInheritOption?` | adds a "follow the theme" dot to the row |

### Shape: one row of circles, and a door to the panel

The control is **one inline row of equal circles** — no field, no trigger
showing a hex, nothing to open for the common case:

```
( ✚ )  ( ⌇ )  ( ● )   ( ○ )( ○ )( ○ )
wheel  drop   custom   white · grey · black
```

1. **Wheel** (rainbow ring + `+`) — "more colors". Always first. Where it GOES
   depends on `target`; see below.
2. **Eyedropper** — samples the screen directly, no overlay. Only present where
   the browser has the API.
3. **Custom dot** — appears only when the current value is not a fixed swatch,
   so the row always shows what is selected. Clicking it reopens the chooser
   rather than re-emitting a value it already holds.
4. **The fixed swatches** — `COLOR_PRESETS`: white, one grey, black. Exactly
   three, and that is a budget, not an accident (see the file's comment).

Exactly one dot is ever ringed. The wheel deliberately never takes the ring:
whenever a custom color is live the custom dot is present and rings itself, so
ringing both would read as two selections.

The row sizes its columns to however many circles it has, so it is always
exactly one line.

### Where the wheel goes: `target`

Pass a `ColorTargetRef` and, under a `ColorTargetProvider`, the wheel aims the
**left-hand ColorPanel** at this field instead of opening the popover. The
button becomes a toggle: clicking it while the panel is already on this field
closes the panel.

Without a target, or outside the provider, the wheel opens this component's own
popover — saturation/brightness square → hue slider → eyedropper / hex field /
copy — so the picker stays complete on its own. That is what `/dev/pickers` and
the component tests exercise.

Never let both happen at once: while the panel owns a field, the popover is
forced closed, because two choosers for one value is the confusion this whole
arrangement exists to avoid.

- **Only ever emits strict 6-digit lowercase hex** matching
  `/^#[0-9a-fA-F]{6}$/` — never rgba or free-form CSS. Every path in (dots,
  dragging, typing, eyedropper) passes `isStrictHexColor` first.
- Saturation/brightness square + hue slider, both arrow-key operable
  (`role="slider"`, live `aria-valuetext`); Home/End jump to the ends.
- Hex text field validates on entry: invalid input shows an inline error and is
  **not** emitted; blur snaps back to the last valid value.
- **Eyedropper** samples any pixel on screen via the native `EyeDropper` API.
  Chromium-only, so it renders only where the API exists — never make it
  load-bearing for a flow.
- Fixed swatches come from the shared allowlist `COLOR_PRESETS`
  (`src/lib/theme/color-presets.ts`); selecting one sets a known-safe hex. That
  list is THREE entries: neutrals earn permanent slots because they are picked
  from memory, and every hue is context, which belongs in the panel.

---

## The left-hand panel

The left slot is no longer color-only. It holds a small union, owned by
`StorefrontDesigner` as `LeftPanelState`:

| Mode | Component | Closes itself? |
|---|---|---|
| `{ kind: "color", ref }` | `ColorPanel.tsx` | Yes — when `resolveColorTarget` stops resolving (the block was deleted or undone away) |
| `{ kind: "library", tab }` | `LibraryPanel.tsx` | No — it names nothing, so it stays until dismissed |

### LibraryPanel: "what can I put on the canvas?"

`LibraryPanel.tsx` owns the header, the close button and a two-tab strip; the
tabs are two bodies:

- **Uploads** (`UploadsPanel.tsx`) — a click-or-drop zone for the seller's own
  artwork, with live upload progress, plus **In this storefront**: every
  distinct upload already on the canvas, keyed by R2 object key. Clicking one
  places another block **re-using that key**, so a logo in three corners is one
  upload, not three. `saveStorefront` already understands this — a key is only
  evicted once no block references it.
- **Shapes** (`ShapesPanel.tsx`) — the full 22-kind library, grouped by
  `SHAPE_GROUPS` (Basic / Polygons / Accents in `shape-specs.ts`). It moved
  here from the toolbar's hover menu, which could only scroll it sideways. The
  toolbar now keeps just two `QUICK_SHAPE_KINDS` inline (square, circle) and
  offers "All shapes" to open this. `tests/unit/shape-library.test.ts` holds
  the groups to `SHAPE_KINDS`, so a kind added later cannot end up unbrowsable.

Picking anything does NOT close the panel: adding three shapes should be three
clicks, not three round trips through the toolbar. For the same reason
`selectBlock` will not swap the slot to the colour panel while the library is
open — inserting a shape selects it, and without that guard the seller's own
library would vanish one shape in.

## ColorPanel

The color mode (`src/components/storefront/ColorPanel.tsx`) is the rich
chooser: one surface for every color in the storefront.

**Why a panel and not a bigger popover.** A standard grid, five palettes, the
recents and the colors already on the canvas do not fit in an overlay anchored to
a swatch, and an overlay that large covers the very canvas you are judging the
color against. Docked opposite the settings panel, the canvas stays visible.

Sections, top to bottom, each a `CollapsibleSection` so the chrome matches the
right panel exactly:

| Section | Source |
|---|---|
| header | the target's label + its current color |
| Inherit | only for optional colors; the "follow the theme" affordance |
| Recently used | `recent-colors.ts`. Absent until there is one. |
| Standard | `STANDARD_COLOR_ROWS` — 3 × 10, columns are hue families |
| Palettes | `COLOR_PALETTES` — five named sets of five |
| In this design | `collectStorefrontColors(theme, blocks)` |
| Custom | `ColorArea` + hex + eyedropper, collapsed by default |

Each section is its own `role="group"` with a naming `aria-label`, and each
swatch's label names its source and hex — a grid of unlabelled colored circles
is meaningless to a screen reader.

Unlike the inline picker, the panel marks **every** instance of the current
color, so one colour can be ringed in Recently used, Standard and a palette at
once. That is deliberate and is not the picker's one-ring rule being broken:
there the row is small and two rings read as two selections, whereas here the
same colour genuinely appears in several places and showing where it lives (in
the Sunset palette, say) is information worth having.

### Targets: address the color, don't pass a callback

The panel edits a `ColorTargetRef` (`src/lib/theme/color-target.ts`) — plain
data naming a color, like `{ kind: "shape-fill", blockKey }`. It never holds an
`onChange`.

That is the whole trick. Carrying a closure from a field in one panel to a
chooser in the other means re-registering on every render and reading a stale
setter the moment the block changes underneath. With a descriptor,
`resolveColorTarget(ref, theme, blocks)` returns null when the target stops
existing — block deleted, undone away, background switched to an image — and the
panel simply closes. `StorefrontDesigner` is the one place that turns a pick back
into a mutation, through the same mutators the inline editors use, so undo
history and the dirty flag behave identically.

Adding a new color field means adding a `kind` here and a case in the designer's
`applyColorTarget`. Do not reach for context with a setter in it.

### Recently used colors

`src/lib/theme/recent-colors.ts` is a MODULE-SCOPE, MEMORY-ONLY store, read
through `useSyncExternalStore` so every mounted picker updates together. Never
move it to localStorage: that rule is argued in full at
`src/lib/search/snapshot-cache.ts` and it applies here too.

A color is recorded when it is **committed** — any swatch tap, an eyedropper
sample, the end of a saturation-square drag, or a finished hex entry. Never per
frame and never per keystroke: those emit continuously, and recording them would
bury the list under one gesture. That is why the custom section takes
`onPreview` and `onCommit` separately rather than one callback.

### Optional colors: use `inherit`, not a reset link

When a stored value is optional (absent = follow the theme), pass `inherit`
rather than adding your own "reset" button. It becomes its own dot in the row —
filled with the color the block actually renders while inheriting, and ringed
while no override is stored. While inheriting, no quick swatch is marked active
even if the hex happens to match, and no custom dot appears: there is no
override to show.

Only pass `inherit` when clearing the value actually produces the color in
`inherit.value`. `ShapeBlock.borderColor` deliberately does **not** use it:
`ShapeTileContent` omits the CSS property entirely when it is absent, so
clearing would yield a browser default rather than a known color.

---

## Adoption

All call sites are migrated. The pickers are used by:

- `DatePicker` — the Orders date-range filter (`OrdersToolbar.tsx`).
- `ColorPicker` — storefront accent (`ThemePanel.tsx`), solid + gradient
  backgrounds (`BackgroundEditor.tsx`), per-block text color
  (`TextBlockEditor.tsx`, with `inherit`), shape fill / border colors
  (`ShapeBlockEditor.tsx`), and the price tag's fill / text / border
  (`PriceTagControls.tsx`, all three with `inherit`).

The price tag's target is the only one that spans two scopes: the same three
colors live on the theme and on a tile's overrides, so its ref carries an
OPTIONAL `blockKey` (absent = the theme) and `PriceTagControls` takes a `scope`
prop naming which. A multi-selection passes `scope="many"` and no target at
all: one edit there writes to every selected tile, so there is no single field
for the panel to name, and the wheels fall back to their own popovers.

Every one of them passes a `target`, and all sit under the one
`ColorTargetProvider` at the root of `StorefrontDesigner.tsx` — which is why
neither `ControlsPanel` nor `ThemePanel` in between carries a color prop. Only
the opener travels through context; the panel's data comes down as props from
the designer, which owns the state anyway.

Rendering a `ColorPicker` with no target, or outside the provider, is a
supported state: it falls back to its own popover. That is what `/dev/pickers`
and the component tests do, and it is also what `TextBlockEditor` does in
group-edit mode, where one picker writes to several blocks and a single-block
target would be a lie.
