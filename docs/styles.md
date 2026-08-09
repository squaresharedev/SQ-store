# Square Share — Product Design System & Style Guide

> The design system for the **Square Share product** — the creator dashboard
> (`store.squareshare.to`), the marketplace, and the discovery feed. Written so an
> agent or a human can rebuild the look and feel from scratch.
> Stack: **Next.js (App Router) + React + TypeScript + Tailwind CSS v4 (`@theme`) +
> shadcn/ui + lucide-react**.
>
> This supersedes the earlier brutalist/dark spec (which described the public
> marketing landing only). The product UI is **light, calm, and content-first**.

---

## 0. The one rule: EVERYTHING is tokenized

**No raw values in components. Ever.** Every color, radius, spacing step, font
size, weight, line-height, shadow, duration, and z-index a component uses **must**
reference a token defined in §2–§9. If you need a value that has no token, **add
the token first**, then use it.

- ❌ `className="bg-[#0a0a0a] rounded-[8px] p-[16px] text-[#737373]"`
- ✅ `className="bg-primary rounded-md p-4 text-muted-foreground"`
- ❌ inline `style={{ color: "#a855f7" }}`
- ✅ a token: `text-brand` (and only where §2.4 permits)

Tokens are declared once in Tailwind v4 `@theme` (primitives) + a semantic layer
(`:root`). Components consume only the **semantic** and **utility** tokens, never
the raw primitives directly. This keeps the whole product themeable from one file
and makes a future dark mode or white-label a token swap, not a refactor.

---

## 1. Brand Essence

Square Share is where creators show and sell their work. **The creators' artwork
is the color; the interface is not.** The chrome stays out of the way.

- **Light and clean.** White surfaces, generous whitespace, thin neutral
  hairlines. A modern, quiet SaaS canvas that lets photos and art pop.
- **Black is the action color.** Primary buttons, the logo mark, the active nav
  state, and key emphasis are near-black on white. High contrast, zero fuss.
- **Neutral greys do the structural work.** Borders, muted text, placeholder
  cells, icons — all from a single neutral ramp. No competing hues.
- **Purple is reserved, not decorative.** The brand purple exists but is used
  **sparingly** (see §2.4). Default to neutral/black; reach for purple only for a
  single deliberate brand moment. If you can avoid it, avoid it.
- **Soft, not brutalist.** Corners are rounded on a small radius scale — pills for
  search and avatars, gentle radii for cards, buttons, and tiles. (The black
  **square** logo still nods to the name; the rest of the UI breathes.)
- **The grid is the hero.** The bento/masonry grid of artifacts is the core
  layout unit. Empty slots are first-class (dashed placeholder cells).
- **Motion is quiet and reduced-motion-safe.** Short, functional transitions
  only. Every animation has a `prefers-reduced-motion` fallback.

**Copy voice:** plain, direct, lowercase-friendly, no marketing fluff, **no em
dashes** in user-facing copy (use commas or periods).

---

## 2. Color

### 2.1 Primitive palette (Tailwind v4 `@theme`)

Raw values live here and **nowhere else**. Neutral ramp is pure grey (no blue
tint), matching the product.

```css
@theme {
  --color-white:        #ffffff;
  --color-neutral-50:   #fafafa;
  --color-neutral-100:  #f5f5f5;
  --color-neutral-200:  #e5e5e5;
  --color-neutral-300:  #d4d4d4;
  --color-neutral-400:  #a3a3a3;
  --color-neutral-500:  #737373;
  --color-neutral-600:  #525252;
  --color-neutral-700:  #404040;
  --color-neutral-800:  #262626;
  --color-neutral-900:  #171717;
  --color-neutral-950:  #0a0a0a;
  --color-black:        #000000;

  /* Reserved brand accent — see §2.4. Default components do NOT use this. */
  --color-brand-purple: #a855f7;

  /* Feedback */
  --color-danger:  #ef4444;
  --color-danger-strong: #b91c1c; /* small text on light surfaces (badges) */
  --color-success: #15803d;
}
```

### 2.2 Semantic tokens (`:root`)

Components consume **these**, not the primitives above. (shadcn-compatible names,
so `bg-background`, `text-foreground`, `border-border`, `bg-primary`, etc. work.)

```css
:root {
  /* Surfaces */
  --background:          var(--color-white);      /* app background */
  --surface:             var(--color-white);      /* cards, bars, sheets */
  --surface-muted:       var(--color-neutral-50);  /* subtle fills, hover rows */

  /* Text */
  --foreground:          var(--color-neutral-900); /* primary text, headings */
  --muted-foreground:    var(--color-neutral-500); /* meta, email, placeholder text */
  --subtle-foreground:   var(--color-neutral-400); /* faintest labels, icons idle */

  /* Lines */
  --border:              var(--color-neutral-200); /* default hairline */
  --border-strong:       var(--color-neutral-300); /* inputs, emphasized edges */
  --input:               var(--color-neutral-200);
  --ring:                var(--color-neutral-900); /* focus ring (with offset) */

  /* Primary action = black */
  --primary:             var(--color-neutral-950);
  --primary-hover:       var(--color-neutral-800);
  --primary-foreground:  var(--color-white);

  /* Secondary / neutral surfaces */
  --secondary:           var(--color-neutral-100);
  --secondary-foreground:var(--color-neutral-900);
  --muted:               var(--color-neutral-100);
  --accent:              var(--color-neutral-100); /* hover surface for controls */
  --accent-foreground:   var(--color-neutral-900);

  /* Card + popover (shadcn) */
  --card:                var(--surface);
  --card-foreground:     var(--foreground);
  --popover:             var(--surface);
  --popover-foreground:  var(--foreground);

  /* Grid placeholders (empty bento cells) */
  --placeholder:         var(--color-neutral-100); /* filled empty cell */
  --placeholder-border:  var(--color-neutral-200); /* dashed empty cell */

  /* Feedback */
  --destructive:         var(--color-danger);
  --destructive-foreground: var(--color-white);

  /* Reserved brand — map, but use per §2.4 only */
  --brand:               var(--color-brand-purple);
  --brand-foreground:    var(--color-white);
}
```

### 2.3 Usage ladder

| Role | Token | Where |
|---|---|---|
| Page background | `--background` | app shell, page |
| Card / bar / sheet | `--surface` / `--card` | collection cards, search bar, top bar |
| Heading / primary text | `--foreground` | "My photos", "builderboy", body |
| Meta / secondary text | `--muted-foreground` | "5 artifacts · 3/15/2026", email, placeholders |
| Faint / idle icon | `--subtle-foreground` | idle sidebar icons, faint captions |
| Hairline / divider | `--border` | card borders, footer top, sidebar edge |
| Input / strong edge | `--border-strong` / `--input` | search bar, text inputs |
| Primary button / logo / active nav | `--primary` (+ `--primary-foreground`) | Add Artifact, Follow, logo, active icon |
| Hover surface | `--accent` / `--surface-muted` | icon-button hover, list-row hover |
| Empty grid cell | `--placeholder` / `--placeholder-border` | bento placeholder tiles |
| Focus ring | `--ring` | keyboard focus (with `--ring-offset`) |
| Error | `--destructive` | invalid input, error text |

### 2.4 Purple policy (read this before using purple)

`--brand` (purple `#a855f7`) is a **reserved** token. The product UI in the
reference screenshots uses **zero** purple in its chrome — buttons, nav, cards,
and text are all neutral/black. Follow that.

Purple is permitted **only** for a single, intentional brand moment and only when
a neutral would genuinely be worse. Sanctioned uses, at most one per surface:

- Text **selection** highlight (`::selection`) — optional.
- A one-off brand flourish on a marketing/empty-state illustration.

Purple is **not** allowed for: primary buttons, links, focus rings, hovers,
active states, borders, or icons. When in doubt, use `--primary`/neutral.

---

## 3. Radius

Soft, small scale. Pills for round things, gentle radii for surfaces.

```css
@theme {
  --radius-none: 0px;
  --radius-sm:   0.375rem;  /* 6px  — buttons, icon buttons, inputs, image tiles, cells */
  --radius-md:   0.5rem;    /* 8px  — cards, popovers, menus */
  --radius-lg:   0.75rem;   /* 12px — large panels / modals */
  --radius-full: 9999px;    /* pills: search bar, chips; circles: avatars */
}
:root { --radius: var(--radius-md); } /* default surface radius */
```

| Element | Token |
|---|---|
| Search bar, chips, avatar | `--radius-full` |
| Buttons, icon buttons, inputs, image/artifact tiles, placeholder cells | `--radius-sm` |
| Cards (collection card), popovers, dropdowns | `--radius-md` |
| Modals, large panels | `--radius-lg` |
| Logo square | `--radius-sm` (subtle) |

---

## 4. Spacing & sizing

4px base scale. Use steps; never arbitrary px.

```css
@theme {
  --spacing-0:  0px;      --spacing-1: 0.25rem;  --spacing-2: 0.5rem;
  --spacing-3:  0.75rem;  --spacing-4: 1rem;     --spacing-5: 1.25rem;
  --spacing-6:  1.5rem;   --spacing-8: 2rem;     --spacing-10: 2.5rem;
  --spacing-12: 3rem;     --spacing-16: 4rem;    --spacing-20: 5rem;
}
```

Layout sizing tokens:

```css
:root {
  --rail-width:     4rem;    /* 64px left icon sidebar */
  --header-height:  4rem;    /* top bar */
  --container-max:  80rem;   /* ~1280px content column */
  --container-pad:  1.5rem;  /* horizontal page padding (px-6) */
  --grid-gap:       0.5rem;  /* bento gap (8px) */
  --card-pad:       1rem;    /* card inner padding */
}
```

- Standard page: `max-width: var(--container-max)`, centered, `padding-inline: var(--container-pad)`.
- Content sits to the right of the fixed rail (`margin-left: var(--rail-width)` or a grid column).

---

## 5. Typography

### 5.1 Families (self-hosted via `next/font/local`)

```css
@theme {
  --font-sans:     "Geist", ui-sans-serif, system-ui, sans-serif;   /* UI + body (default) */
  --font-ui-muted: "Inter", ui-sans-serif, system-ui, sans-serif;   /* muted captions / labels */
  --font-display:  "Space Grotesk", var(--font-sans);               /* marketing hero only */
  --font-mono:     "JetBrains Mono", ui-monospace, monospace;       /* code / technical meta only */
  --font-hand:     "Shadows Into Light", cursive;                   /* founder voice (marketing only) */
}
```

- **`--font-sans` (Geist)** is the product default: headings, body, buttons, nav.
- **`--font-ui-muted` (Inter)** for muted caption/label text (meta rows, eyebrows,
  footer, form labels). Utility: `font-inter`.
- `--font-display` is **not** used in product UI — reserve Space Grotesk for the
  public marketing hero. Product headings are `--font-sans` semibold.

### 5.2 Scale, weight, line-height, tracking

```css
@theme {
  --text-xs:   0.75rem;   --text-sm:  0.875rem;  --text-base: 1rem;
  --text-lg:   1.125rem;  --text-xl:  1.25rem;   --text-2xl:  1.5rem;
  --text-3xl:  1.875rem;  --text-4xl: 2.25rem;

  --font-weight-normal:   400;
  --font-weight-medium:   500;
  --font-weight-semibold: 600;
  --font-weight-bold:     700;

  --leading-tight:  1.2;  --leading-snug: 1.35;
  --leading-normal: 1.5;  --leading-relaxed: 1.625;

  --tracking-tight:  -0.02em;
  --tracking-normal: 0em;
  --tracking-wide:   0.05em;
  --tracking-label:  0.1em;   /* uppercase eyebrows */
}
```

**Weight rule (product):** headings are **semibold (600)** or **bold (700)** — never
900. Body is normal (400); emphasized meta is medium (500). This is the key break
from the old brutalist spec (no `font-black` in the app).

| Element | Tokens |
|---|---|
| Page title ("My photos") | `--font-sans` · `--text-2xl` md:`--text-3xl` · `--font-weight-semibold` · `--foreground` |
| Section heading ("Collections") | `--font-sans` · `--text-xl` · `--font-weight-semibold` · `--foreground` |
| Profile name ("builderboy") | `--font-sans` · `--text-2xl` · `--font-weight-bold` · `--foreground` |
| Card title ("tester") | `--font-sans` · `--text-base` · `--font-weight-semibold` · `--foreground` |
| Body | `--font-sans` · `--text-base` · `--leading-normal` · `--foreground` |
| Meta / caption | `--font-ui-muted` · `--text-sm` · `--muted-foreground` |
| Eyebrow / label | `--font-ui-muted` · `--text-xs` · uppercase · `--tracking-label` · `--muted-foreground` |
| Button label | `--font-sans` · `--text-sm` · `--font-weight-medium` |

---

## 6. Elevation & motion

### 6.1 Shadows (soft, rare — depth comes from borders first)

```css
@theme {
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.08);
  --shadow-lg: 0 12px 32px rgba(0,0,0,0.12);
}
:root { --ring-offset: var(--background); }
```

Cards use a **border first**, with `--shadow-sm` at most. Overlays (menus, modals)
use `--shadow-md`/`--shadow-lg`.

### 6.2 Motion

```css
@theme {
  --duration-fast: 120ms;
  --duration:      180ms;
  --duration-slow: 260ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out:      cubic-bezier(0.16, 1, 0.3, 1);
}
```

- Hover/focus color + background transitions: `--duration` · `--ease-standard`.
- Entrance/expansion: `--duration-slow` · `--ease-out`.
- **Reduced motion:** wrap every non-trivial animation in
  `@media (prefers-reduced-motion: reduce)` (or `motion-reduce:`) and fall back to
  an instant state change. No parallax, no decorative movement.

### 6.3 Z-index

```css
@theme {
  --z-base: 0; --z-rail: 30; --z-header: 20; --z-dropdown: 40; --z-overlay: 50;
  --z-search: 60; --z-toast: 70;
}
```

Toasts sit above EVERYTHING, universal search included. Modals raise them (the
invite modal, the password modal, every delete confirm), and a confirmation
rendered behind the surface that triggered it is not a confirmation.

---

## 7. Layout shell

```
┌────┬──────────────────────────────────────────────┐
│    │  [ top bar: title / search ........ actions ] │
│ R  ├──────────────────────────────────────────────┤
│ A  │                                                │
│ I  │        content column (container-max)          │
│ L  │        bento grid / collection cards           │
│    │                                                │
│    ├──────────────────────────────────────────────┤
│    │                 footer (feed)                  │
└────┴──────────────────────────────────────────────┘
```

- **Rail (left icon sidebar):** fixed, `width: --rail-width`, `background: --surface`,
  `border-right: 1px solid --border`, `z-index: --z-rail`. Vertical stack: logo
  (top), primary nav icons, flex spacer, then avatar + sign-out at the bottom.
- **Content:** offset by the rail; centered `--container-max` with `--container-pad`.
- **Top bar:** `height: --header-height`; page title or centered search on the left/
  center, primary actions on the right.
- **Footer (feed/marketplace):** `border-top: 1px solid --border`, centered muted
  links separated by a divider glyph, `--text-sm` · `--muted-foreground`.

---

## 8. Components (token-only)

Every value below is a token reference. If a component needs something new, add a
token in §2–§6 first.

### 8.1 Logo mark
Black rounded square with white monogram. `size: --spacing-8` (or `2rem`),
`background: --primary`, `color: --primary-foreground`, `radius: --radius-sm`,
`--font-sans` · `--font-weight-bold`. Centered "S"/"SS".

### 8.2 Rail nav icon button
`size: --spacing-10` square, `radius: --radius-sm`, `color: --subtle-foreground`
idle → `--foreground` on hover/active, hover `background: --accent`. Active route
gets `color: --foreground` (and optionally a subtle `--accent` fill). Icons from
lucide (`User`, `Settings`, `Layers`), `stroke-width: 2`, sized to `size-5`.
Focus: `--ring` with `--ring-offset`.

### 8.3 Primary button (Add Artifact, Follow)
`background: --primary` → hover `--primary-hover`; `color: --primary-foreground`;
`radius: --radius-sm`; padding `--spacing-2` `--spacing-4`; `--font-sans` ·
`--text-sm` · `--font-weight-medium`; optional leading lucide icon (`Plus`,
`UserPlus`) at `size-4`, gap `--spacing-2`. Focus: `2px --ring` + `2px --ring-offset`.
Press: subtle `active` scale (respect reduced motion). Disabled: `opacity 0.5`.

### 8.4 Secondary / icon button (top-right gear, pin toggle)
`background: --surface`; `border: 1px solid --border`; `color: --muted-foreground`;
`radius: --radius-sm`; hover `background: --surface-muted`,
`border-color: --border-strong`. Square for icon-only (`size: --spacing-10`).

### 8.5 Search bar (feed)
Pill: `radius: --radius-full`; `background: --surface`; `border: 1px solid --border`;
height ≈ `--spacing-12`; leading `Search` icon in `--subtle-foreground`; placeholder
text `--muted-foreground` ("Search for creators or collections"); centered, capped
at a comfortable `max-width`. Focus: `border-color: --border-strong` + `--ring`.

### 8.6 Text input
`background: --surface`; `border: 1px solid --input`; `radius: --radius-sm`;
`color: --foreground`; placeholder `--muted-foreground`; padding `--spacing-3`
`--spacing-4`; focus `border-color: --foreground` (or `--ring`), no color shift.
Force `font-size: 16px` on mobile text inputs to prevent iOS zoom. Error: `border:
--destructive`, message `--text-sm` · `--destructive`.

### 8.7 Collection card
`background: --card`; `border: 1px solid --border`; `radius: --radius-md`;
`box-shadow: --shadow-sm`; padding `--card-pad`. Contents top→bottom:
1. **Preview** — a mini bento grid (see §8.9) filling the card top, `radius: --radius-sm`
   clip, with `--placeholder` empty cells to convey the grid.
2. **Title** — `--text-base` · `--font-weight-semibold` · `--foreground`.
3. **Meta row** — leading `Image` icon (`--subtle-foreground`) + "N artifacts ·
   M/D/YYYY" in `--font-ui-muted` · `--text-sm` · `--muted-foreground`.
Optional pin/unpin toggle top-right (§8.4). Hover: `border-color: --border-strong`
(and/or `--shadow-md`), `transition: --duration`.

### 8.8 Avatar
Circle: `radius: --radius-full`; sizes `--spacing-8` (rail/inline) up to a larger
profile size; optional `1px --border` ring. Image `object-cover`; fallback = initials
on `--secondary` / `--secondary-foreground`.

### 8.9 Bento / artifact grid
The core layout. CSS grid, `gap: --grid-gap`, square base cell; artifacts span
`1×1`, `2×1`, `2×2`, etc. Tiles: `radius: --radius-sm`, `object-fit: cover`,
`background: --surface-muted` while loading.
- **Placeholder / empty cell** (grid editor): `radius: --radius-sm`, either a
  filled `background: --placeholder` cell **or** a `1px dashed --placeholder-border`
  outline over transparent. Represents an open drop target.

### 8.10 Footer (feed)
`border-top: 1px solid --border`; centered row: "© {year} SquareShare" +
divider + "Community Guidelines" + "Privacy Policy"; links `--muted-foreground` →
hover `--foreground`; `--font-ui-muted` · `--text-sm`.

### 8.11 Divider
Hairline `1px --border`. Vertical separators (footer) `1px --border`,
`height: 1em`, `--subtle-foreground`.

### 8.12 Feedback: toast vs inline

There is ONE rule, and it is about time, not about severity:

- **Toast** (`components/ui/Toast.tsx`) — the OUTCOME of something the user
  just did. Saved, uploaded, invited, removed, and the failures of all of
  those. Success and error alike. The outcome is over, so the message may
  leave. A save whose only evidence is "the page looks the same" is
  indistinguishable from a no-op, which is the whole reason this exists.
- **Inline** — anything the user must act on, or might need to re-read.
  WHICH field is wrong (said beside that field), and page states that need a
  decision or a retry button. A toast leaves; those must not.

Never both for one SUCCESS. A form does not print "Saved." next to a button that
has already gone green next to a toast that already said it.

Failures have one sanctioned exception, and only one: **a form long enough that
its Save button is off-screen from the field at fault** — today that is the
product form alone. There the failure renders inline beside Save *and* as a
toast. They are not duplicates doing the same job: the toast is what reaches the
eye at the moment of the click, the notice is what is still on the page eight
seconds later while the fix is being typed. Everywhere else, one channel.

Shape: sharp corners and the same neutral `--border` as every other floating
surface, the tone mark, a one-line headline, optional detail lines, a dismiss
button on the card's vertical axis, and a hairline lifetime bar along the
bottom. One column width (`w-96`), so a stack of three reads as one channel
rather than three unrelated things.

**Tone lives in the mark, and nowhere else.** A bare stroke — check, cross,
"i" — drawn on in the tone's own colour as the toast arrives. No chip, plate or
disc behind it: the card is already a bordered box, and a filled badge makes a
second box inside the first. The border stays grey for every tone, because a red
card restates louder what the mark has already said. Live specimens at
`/dev/toast`.

The marks are sized UNEVENLY on purpose: the check and cross ship at `size-5`
running edge to edge of their viewBox, the "i" at `size-4`. Geometry reads small
and carries the whole outcome; a glyph scaled to match stops reading as an icon
and starts reading as a typo. All of them stay under the size of the words —
a mark is what you glance at on the way to the message, and one sized to compete
with the sentence becomes the thing being read. Each hangs in an `h-5` box so it
centres on the headline's line regardless of its own size, and the stroke weight
is set per tone so the on-screen weight comes out even.

Anchored BOTTOM-right, the corner the eye returns to after pressing a button and
the one furthest from the left nav rail's own controls. Nothing underneath is
blocked: only the cards take pointer events, so a Save button beneath a toast
stays pressable. Lifted clear of the phone's bottom furniture (the storefront
editor's floating toolbar, the home indicator) and settled onto the corner from
`sm` up, where the dismiss target relaxes from a 44px thumb target to the
overlay standard.

Dark mode: every colour is a token that the dark layer re-steps, with one
exception worth knowing — `--color-success` is a green-700 chosen for white, so
on the near-black card it needs its companion `--color-success-dark`
(`text-success dark:text-success-dark`). Same pattern as `--color-crown`.

Behaviour worth keeping if this is ever reimplemented: hover, focus and a
backgrounded tab all pause the clock (and bank the remainder); an identical
message refreshes the toast already on screen instead of stacking a copy; the
stack caps at three, dropping the oldest.

Server-action forms do not call it by hand — `useActionToast(state)` bridges a
`useActionState` result straight through.

### 8.13 Info tip: the one "?"

There is ONE question mark in the product (`components/ui/InfoTip.tsx`, classes
in `infoTipTriggerClass` / `infoTipBubbleClass`). Never draw a second one.

When to reach for it, and when not to:

- **A tip** — a caveat, a consequence, or a rule that only some people need:
  where a save actually lands, which other setting a value inherits from.
- **NOT a tip** — anything the user must act on (that is inline, §8.12), and
  anything that only restates its own control. A paragraph under "Show price
  on hover" reading "the price stays hidden until a buyer hovers" is noise; it
  was deleted rather than tucked behind a "?".

Shape: a 24px square button carrying the lucide `CircleQuestionMark` glyph,
muted at rest and `--foreground` on hover, sitting immediately after the label
it belongs to (`flex items-center gap-1.5`). The bubble it reveals is the same
floating panel as every other overlay — sharp, hairline `--border`,
`--popover`, `shadow-lg` — one column wide (`w-64`) so the sentence wraps like
prose rather than stretching across a panel.

Three ways in, because leaving any one out strands a whole input method:
hover (mouse), Tab (keyboard, Esc closes), and tap (touch, where an outside
press closes it). A pointer that is not a mouse must NOT be read as a hover:
Chromium fires `pointerover` before a tap, so a tip that opens on any
`pointerover` opens and is immediately closed by its own tap.

The bubble is `position: fixed` in a portal on `<body>`, placed from the
trigger's rect and clamped to the viewport. An absolutely-positioned tip is
clipped the moment it is used inside anything that scrolls — which the
storefront designer's side panel does.

---

## 9. Iconography

- **Library:** `lucide-react`, `stroke-width: 2` (idle icons may use `--subtle-foreground`).
  Seen: `User`, `Settings`, `Layers`, `Plus`, `UserPlus`, `Search`, `Image`,
  `Pin`/`PinOff`, `LogOut`.
- Icons inherit `currentColor` from a semantic text token — never hardcode icon
  colors. Sizes: `size-4` (in buttons), `size-5` (rail).
- Brand social glyphs (marketing) remain inline `simple-icons` paths.

---

## 10. Accessibility & responsive

- **Contrast:** body/heading text uses `--foreground` (≥ AA on `--background`).
  `--muted-foreground` (neutral-500) is for secondary text only.
- **Focus:** visible `--ring` + `--ring-offset` on every interactive element
  (`:focus-visible`), never removed.
- **Reduced motion:** mandatory fallback for all motion (§6.2).
- **iOS zoom guard:** text inputs at `font-size: 16px`.
- **Landmarks/labels:** icon-only buttons get `aria-label`; the rail is a labelled
  `nav`; decorative images `aria-hidden`.
- **Breakpoints (Tailwind defaults):** `sm 640 · md 768 · lg 1024 · xl 1280`. The
  rail may collapse to a bottom bar under `md`; bento columns reduce; content keeps
  `--container-pad` gutters.

---

## 11. Quick-reference token sheet

```
SURFACES     --background / --surface (white) · --surface-muted (neutral-50)
TEXT         --foreground (n-900) · --muted-foreground (n-500) · --subtle-foreground (n-400)
LINES        --border (n-200) · --border-strong (n-300) · --input (n-200)
ACTION       --primary (n-950 / black) · --primary-hover (n-800) · --primary-foreground (white)
NEUTRAL      --secondary / --muted / --accent (n-100)
PLACEHOLDER  --placeholder (n-100) · --placeholder-border (n-200)
FOCUS        --ring (n-900) + --ring-offset (background)
FEEDBACK     --destructive (#ef4444)
BRAND        --brand (#a855f7)  ← reserved, sparing, never in chrome (§2.4)
RADIUS       sm 6 · md 8 · lg 12 · full ∞   (default --radius = md)
SPACE        4px base: 1..20
FONTS        sans: Geist (UI/body) · inter: Inter (muted labels)
             display: Space Grotesk (marketing only) · mono: JetBrains Mono (code only)
WEIGHT       headings 600/700 (NO 900) · body 400 · emphasis 500
SHADOW       xs/sm (cards) · md/lg (overlays) — borders first
MOTION       --duration 180ms · --ease-standard · reduced-motion fallback always
LAYOUT       rail 64 · header 64 · container 1280 · pad 24 · grid-gap 8
RULE         one primary = black · purple reserved · everything tokenized
```

---

## 12. Replication checklist

1. Declare the **primitive** palette, radius, spacing, type, shadow, motion, and
   z-index tokens in Tailwind v4 `@theme` (§2.1, §3–§6).
2. Declare the **semantic** layer in `:root` (§2.2) — `--primary` is **black**,
   `--radius` is non-zero, `--brand` is purple but unused by default.
3. Wire fonts via `next/font/local`; `--font-sans` (Geist) is the UI default,
   `font-inter` for muted labels. No `font-display` in product UI.
4. Build the shell: fixed icon **rail**, top bar, `--container-max` content, feed
   footer (§7).
5. Build components from §8 — **token references only**, no literals.
6. Keep the palette neutral: black primary, grey structure, artwork provides color.
   Purple only per §2.4.
7. Corners rounded on the §3 scale (pills for search/avatar).
8. Headings semibold/bold, never 900.
9. Focus rings + reduced-motion fallbacks everywhere (§10).
10. Lint for raw values: no hex, no arbitrary `[...]` px/color in components — if
    you reach for one, add a token instead.
```
