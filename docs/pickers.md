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

```tsx
<ColorPicker label="Accent" value={theme.accent} onChange={(hex) => …} />
```

Props: `value: string` (strict `#rrggbb`), `onChange: (hex: string) => void`,
optional `label`, `id`.

- **Only ever emits strict 6-digit lowercase hex** matching
  `/^#[0-9a-fA-F]{6}$/` — never rgba or free-form CSS.
- Saturation/brightness square + hue slider, both arrow-key operable
  (`role="slider"`, live `aria-valuetext`).
- Hex text field validates on entry: invalid input shows an inline error and is
  **not** emitted; blur snaps back to the last valid value.
- Preset swatches come from the shared allowlist `COLOR_PRESETS`
  (`src/lib/theme/color-presets.ts`); selecting one sets a known-safe hex.

---

## Adoption points (do in a later step — not this run)

1. **Orders date filter** — `src/components/orders/OrdersToolbar.tsx`.
   Replace the two `<input type="date">` blocks ("from" / "to", lines ~136–162)
   with one range `DatePicker`:

   ```tsx
   <DatePicker
     mode="range"
     label="date"
     value={{ from: filters.dateFrom ?? null, to: filters.dateTo ?? null }}
     onChange={({ from, to }) =>
       emit({ dateFrom: from ?? undefined, dateTo: to ?? undefined })
     }
   />
   ```

   `emit()` already strips `undefined` keys, so this preserves the existing
   `OrderFilters` contract exactly.

2. **Storefront theme colors** — `src/components/storefront/ThemePanel.tsx`.
   Swap the accent `ColorInput` (line ~85) for `ColorPicker` (same
   `value`/`onChange(hex)` signature — a drop-in):

   ```tsx
   <ColorPicker id={`${fieldId}-accent`} label="Accent" value={theme.accent}
     onChange={(accent) => onChange({ ...theme, accent })} />
   ```

   For the custom background color inside
   `src/components/storefront/BackgroundPresetPicker.tsx`, the inner `ColorInput`
   (line ~73) can likewise become `ColorPicker` — it already emits strict hex,
   so the schema/security contract is unchanged. (Background *gradient* presets
   stay their own key-based control; those are not hex and are out of scope for
   a hex-only picker.)

3. **Optional** — point the storefront accent field's future swatches at the
   same `COLOR_PRESETS` list so the dashboard and storefront share one allowlist.
