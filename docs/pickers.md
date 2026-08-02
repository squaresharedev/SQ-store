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
- `src/lib/theme/color-presets.ts` — shared hex swatch allowlist.

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

### Shape: a row of circles, panel on demand

The control is **one inline row of equal circles** — no field, no trigger
showing a hex, nothing to open for the common case:

```
( ✚ )  ( ⌇ )  ( ● )   ( ○ )( ○ )( ○ )( ○ )( ○ )
wheel  drop   custom   the quick swatches
```

1. **Color wheel** (rainbow ring + `+`) — opens the full picker. Always first.
2. **Eyedropper** — samples the screen directly, no panel. Only present where
   the browser has the API.
3. **Custom dot** — appears only when the current value is not a quick swatch,
   so the row always shows what is selected. Clicking it reopens the panel
   rather than re-emitting a value it already holds.
4. **Quick swatches** — `COLOR_PRESETS`, a short neutral ramp.

Exactly one dot is ever ringed. The wheel deliberately never takes the ring:
whenever a custom color is live the custom dot is present and rings itself, so
ringing both would read as two selections.

The panel (opened from the wheel) is just: saturation/brightness square → hue
slider → eyedropper / hex field / copy. Keep it that short — everything else
belongs in the row.

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
- Quick swatches come from the shared allowlist `COLOR_PRESETS`
  (`src/lib/theme/color-presets.ts`); selecting one sets a known-safe hex. Keep
  that list SHORT and neutral — it is a one-tap shortcut, not a palette, and
  every extra entry costs the row its legibility. Hues come from the wheel.

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
  (`TextBlockEditor.tsx`, with `inherit`), and shape fill / border colors
  (`ShapeBlockEditor.tsx`).
