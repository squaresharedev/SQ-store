# Square Share — Design System & Style Guide

> A complete specification for replicating the Square Share visual language. Written so an AI agent (or a human) can rebuild the look, feel, and motion of the site from scratch. Stack: **Next.js (App Router) + React + TypeScript + Tailwind CSS v4 + shadcn/ui + Framer Motion + lucide-react**.

---

## 1. Brand Essence

Square Share turns any website into a store. The visual language is **brutalist-tech-meets-pixel-craft**:

- **High contrast.** Pure black and pure white surfaces, never grey-washed. Sections hard-cut between dark and light.
- **Zero rounding on brand elements.** The global radius token is `0rem`. Square corners are the identity (the name is "**Square** Share"). Only inherited shadcn primitives (inputs, buttons) keep small radii.
- **One accent, used sparingly.** Electric purple (`#a855f7`, internally "acid") is the *only* chromatic color. Everything else is neutral (black/white/greys). Purple is a scalpel, not a paintbrush — a single glow, a hover state, a selection highlight.
- **Pixel motif.** Squares/pixels recur everywhere: pixel-sweep buttons, pixel-grid footer, jagged "pixel edge" section seams, a cursor-swarm that spells words, a weaving pixel trail. The grid cell is a first-class design unit.
- **Motion is purposeful and reduced-motion-safe.** Every animation has a `prefers-reduced-motion` fallback. Nothing moves just to move.
- **Built-in-the-open, handcrafted voice.** Founder copy uses a hand-written font for self-corrections. Tone is plain, confident, no marketing fluff.

**Copy rule:** No em dashes in user-facing copy. Use commas, periods, or "no spam"-style phrasing instead.

---

## 2. Color System

### 2.1 Brand tokens (Tailwind v4 `@theme`)

```css
@theme {
  --color-acid:          #a855f7;  /* electric purple — the only accent */
  --color-acid-hover:    #9333ea;  /* darker purple for hover */
  --color-surface-dark:  #000000;  /* pure black */
  --color-surface-light: #F9F9F9;  /* near-white section bg */
  --shadow-btn-glow:     0 0 30px rgba(168, 85, 247, 0.3);
}
```

These expose Tailwind utilities like `text-acid`, `bg-acid`, `border-acid`, `shadow-btn-glow`.

### 2.2 Core palette

| Role | Value | Usage |
|---|---|---|
| **Acid / Primary** | `#a855f7` (= `rgb(168,85,247)`) | Accent glow, hover, focus ring, selection, links-on-hover, checkmarks, heart |
| Acid hover | `#9333ea` | Pressed/darker purple |
| Pure black | `#000000` | Dark section backgrounds, dark text on light |
| Off-black (cards) | `#0a0a0c` / `#0a0a0a` | Card base over black (future cards, pixel-button hover) |
| Card fade black | `rgb(6, 6, 8)` | Edge-fade gradients over images |
| Pure white | `#ffffff` | Light section bg, text on dark |
| Light surface | `#F9F9F9` | "How It Works" section bg |
| Scrollbar track | `#000000` | — |
| Scrollbar thumb | `#333333` (hover `#a855f7`) | — |
| Error | `red-500` (`#ef4444`) | Invalid input border |

### 2.3 Text opacity ladder (on dark)

White text is tinted by opacity, never by hue. Memorize this ladder — it is used everywhere:

| Token | Use |
|---|---|
| `text-white` | Headlines, primary text |
| `text-white/60` | Emphasized link |
| `text-white/50` | Body / subheads / nav links |
| `text-white/40` | Footer captions, muted credit |
| `text-white/30` | Placeholder, faint labels |

On light backgrounds the neutral ladder is: `text-neutral-900` (headings) → `text-neutral-600` (body) → `text-neutral-500` (muted) → `text-neutral-400` (eyebrow/faint) → `text-neutral-300/200` (giant ghost numbers).

### 2.4 Border opacity ladder (on dark)

| Token | Use |
|---|---|
| `border-white/20` | Input border (hero) |
| `border-white/18` | Card hover border |
| `border-white/10` | Default card / section dividers / icon buttons |

### 2.5 shadcn / theme variables (OKLCH)

The app runs **dark mode by default** (`<html class="dark">`). The `.dark` block overrides shadcn tokens to the brand:

```css
.dark {
  --background: oklch(0 0 0);          /* black */
  --foreground: oklch(1 0 0);          /* white */
  --card: oklch(0.18 0 0);
  --primary: #a855f7;                  /* acid */
  --primary-foreground: #000000;
  --accent: #a855f7;
  --accent-foreground: #000000;
  --muted-foreground: oklch(0.708 0 0);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 15%);
  --ring: #a855f7;
  --destructive: oklch(0.704 0.191 22.216);
  --radius: 0rem;                      /* inherited from :root — square */
}
```

`:root` (light) keeps neutral greyscale OKLCH ramps; `--radius: 0rem` globally.

### 2.6 Selection & scrollbar

```css
::selection { background: var(--color-acid); color: var(--color-surface-dark); }
/* Scrollbar: 6px wide, black track, #333 thumb → acid on hover */
* { scrollbar-width: thin; scrollbar-color: #333333 #000000; }
```

---

## 3. Typography

### 3.1 Font families (self-hosted via `next/font/local`, all `display: swap`)

| CSS var | Family | Weight range | Role |
|---|---|---|---|
| `--font-display` | **Space Grotesk** | `300 700` | Display headlines (`font-display`) |
| `--font-sans` | **Geist** | `100 900` | Body / UI default (`font-sans`) |
| `--font-mono` | **JetBrains Mono** | `100 800` | Eyebrows, labels, code, footer meta (`font-mono`) |
| `--font-hand` | **Shadows Into Light** | `400` | Hand-written founder voice / self-corrections (`font-hand`) |

> Note: `@theme` declares the *fallback stacks* as `"Space Grotesk"`, `"Inter"`, `"JetBrains Mono"`, but the actual loaded faces are the `localFont` files above (Geist replaces Inter as the sans). Fonts live in `src/app/fonts/*.woff2`. The `<html>` element gets all four `variable` classes plus `font-sans`.

```tsx
// layout.tsx pattern
const spaceGrotesk = localFont({ src: "./fonts/SpaceGrotesk.woff2", weight: "300 700", variable: "--font-display", display: "swap" });
const geist        = localFont({ src: "./fonts/Geist.woff2",        weight: "100 900", variable: "--font-sans",    display: "swap" });
// <html className={cn("dark", spaceGrotesk.variable, jetbrainsMono.variable, shadowsIntoLight.variable, "font-sans", geist.variable)}>
```

### 3.2 Type scale & weights

**Weight rule:** display and important headings are **`font-black` (900)**. There is almost no medium-weight heading — it's black or it's body.

| Element | Classes |
|---|---|
| **Hero H1** | `text-6xl md:text-8xl lg:text-9xl font-black leading-[1.16] md:leading-[0.92] tracking-tight font-display` |
| **Section H2 (dark)** | `font-display text-4xl font-black leading-[1.05] tracking-tight text-white md:text-6xl` |
| **Section H2 (light)** | `font-display text-5xl font-black leading-[1.05] text-neutral-900 md:text-8xl` |
| **About H2** | `font-display text-4xl font-black leading-tight text-neutral-900 md:text-6xl` |
| **CTA H3** | `font-display text-3xl font-black text-neutral-900 md:text-5xl` |
| **Step title H3** | `font-display text-3xl font-black leading-tight text-neutral-900 md:text-4xl` |
| **Card title H3** | `font-display text-xl font-black md:text-2xl` |
| **Giant step number** | `font-display text-6xl font-black leading-none text-neutral-200 md:text-7xl` (ghost grey) |
| **Lead paragraph** | `text-lg md:text-xl text-white/50` (dark) / `text-neutral-600` (light) |
| **Body** | `text-base leading-relaxed text-neutral-600` / `text-white/50` |
| **Small body** | `text-sm leading-relaxed` |
| **Eyebrow / label** | `font-mono text-xs uppercase tracking-[0.25em] text-neutral-400` |
| **Nav / meta link** | `font-mono text-xs uppercase tracking-widest text-white/50` |

**Tracking conventions:**
- Display headlines: `tracking-tight`.
- Footer wordmark: `tracking-tighter`.
- Eyebrows: `tracking-[0.25em]` (wide). Read-more: `tracking-[0.2em]`. Nav: `tracking-widest`.

**Footer wordmark** (signature element): fluid, full-bleed, uppercase, ultra-tight.
```
text-[clamp(2.5rem,11vw,9rem)] font-black uppercase leading-[0.82] tracking-tighter
```

### 3.3 Eyebrow pattern

Every section that has one uses: mono, xs, uppercase, wide tracking, faint color. Example: `<p class="font-mono text-xs uppercase tracking-[0.25em] text-neutral-400">Our Story</p>`.

---

## 4. Spacing, Layout & Containers

### 4.1 Container widths

| Width | Class | Use |
|---|---|---|
| Narrow prose | `max-w-2xl` / `max-w-3xl` | Founder copy, section headers |
| Hero | `max-w-5xl` | Hero content |
| Standard section | `max-w-6xl` | How It Works, Future |
| Wide / footer | `max-w-7xl` | Footer |
| Form (hero) | `max-w-lg`; (footer variant) `max-w-2xl` | Waitlist |

Standard horizontal padding: **`px-6`** everywhere. Always `mx-auto` to center.

### 4.2 Section rhythm

- Full-viewport hero/founder sections: `min-h-screen flex items-center justify-center`.
- Vertical padding: `py-24 md:py-32` (large sections), hero `pt-20 pb-16`.
- Section header to body gap: `mb-10`–`mb-20`.
- `scroll-mt-24` on anchored sections so the sticky offset clears anchors.
- `overflow-x-hidden` on body; `overflow-x-clip` on sections with bleeding art.

### 4.3 Section background alternation (the core rhythm)

Sections hard-cut between dark and light to create the brutalist contrast:

1. **Hero** — `bg-black`, white text.
2. **How It Works** — `bg-[#F9F9F9]` (light), neutral-900 text. Seam from dark above is broken by a **`PixelEdge`** (jagged black pixel border), never a flat line.
3. **Founder / About** — `bg-white`, neutral text.
4. **Future** — `bg-black`, white text.
5. **Footer** — `bg-black` with interactive pixel grid; `border-t border-white/10` and a top fade seam.

### 4.4 Grid & gap conventions

- Two-column rows: `grid items-center gap-8 lg:grid-cols-2 lg:gap-16`. On desktop, alternate sides with `lg:order-1` / `lg:order-2` (`reverse` prop); on mobile always stack text-first.
- Form layout: `flex flex-col sm:flex-row gap-3`.
- Footer columns: `flex flex-col gap-10 sm:flex-row sm:gap-12`, nav link stacks `gap-3`.

---

## 5. Components

### 5.1 PixelButton — the signature CTA

A button whose hover state is a **pixel sweep**: a grid of square cells fades in from the exact point the cursor entered (radial wipe + seeded jitter), and drains back out toward the exit point. The label is two stacked copies that crossfade so text never flashes black-on-black.

**Visual defaults:**
- Base: `#a855f7` background + matching `border-2`, black (`#000000`) label text.
- Hover fill color: `#0a0a0a` (near-black); label crossfades to `hoverTextColor` (commonly `#a855f7` or `#ffffff`).
- Shape: square (no radius), `font-black`, `whitespace-nowrap`, `overflow-hidden`, `isolate`.
- Press: `active:scale-95`, `transition-transform duration-150`.
- Focus: `focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black`.
- Disabled: `disabled:opacity-50 disabled:pointer-events-none`.
- Reduced motion: `motion-reduce:transition-colors` + the pixel overlay is `motion-reduce:hidden` — falls back to a plain color crossfade.

**Key props:** `baseColor`, `hoverColor`, `hoverTextColor`, `pixelSize` (default `13`px square cell), `sweepMs` (default `420`), `directionalWeight` (0..1, default `0.8` = mostly radial-from-cursor, some random jitter).

**Mechanics to replicate:**
- The button width is snapped to a whole number of square cells (`cell = height / rows`, `cols = round(width / cell)`), re-measured on resize and after `document.fonts.ready`, so cells are *always perfect squares*, never rectangles.
- Per-pixel `transition-delay` = `progress * sweepMs`, where `progress = directional * directionalWeight + rand * (1 - directionalWeight)`; `directional` is normalized distance from the pointer origin to the farthest corner. Each cell: `transition-opacity`, `transitionDuration: 150ms`, `boxShadow: 0 0 0 1px hoverColor` (hides sub-pixel seams).
- Hover state is driven by React state (not CSS `:hover`) so origin + opacity land in the same commit.

Typical usage: `<PixelButton className="px-8 py-4 text-base" hoverTextColor="#ffffff">Join the Waitlist</PixelButton>`.

### 5.2 shadcn Button (`ui/button.tsx`)

Secondary system for non-hero buttons (cva variants). Rounded `rounded-lg`, `text-sm font-medium`, `transition-all`, `active:translate-y-px`, `focus-visible:ring-3 focus-visible:ring-ring/50`.
- Variants: `default` (primary acid), `outline`, `secondary`, `ghost`, `destructive`, `link`.
- Sizes: `xs h-6`, `sm h-7`, `default h-8`, `lg h-9`, plus `icon` square sizes. Icons auto-size to `size-4`.

### 5.3 Plain secondary button (Instagram CTA pattern)

For solid non-pixel buttons: `inline-flex items-center justify-center gap-2.5 px-7 py-3.5 text-sm font-bold transition-colors duration-200`, square corners, `bg-white text-black hover:bg-white/85` on dark (or `bg-neutral-900 text-white hover:bg-neutral-700` on light), with `focus-visible:ring-2 focus-visible:ring-offset-2`.

### 5.4 Input (`ui/input.tsx` + waitlist overrides)

Base shadcn input is small (`h-8`, `rounded-lg`). The **waitlist** overrides it to the brand sizing:
- `flex-1 h-auto px-6 py-4 text-base font-medium`
- `focus-visible:border-[#a855f7] focus-visible:ring-0` (acid border on focus, no ring)
- Hero variant: `bg-white/5 border-2 border-white/20 text-white placeholder:text-white/30`
- Footer variant: `bg-white border-2 border-neutral-300 text-neutral-900 placeholder:text-neutral-400`
- Error: append `border-red-500`.
- **Always** set `font-size: 16px` inline (and globally via `input[type=email]{font-size:16px!important}`) to prevent iOS zoom-on-focus.

### 5.5 Cards

**Future roadmap card** (`.future-card`) — opaque dark card that sits "on the road":
```css
border-radius: 0;
border: 1px solid rgba(255,255,255,0.1);
background:
  linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02)),
  #0a0a0c;                                   /* opaque, NOT translucent */
transition: border-color 0.3s ease;          /* hover → rgba(255,255,255,0.18) */
overflow: hidden;
```
Inside a card you may layer: a glow, a dot/line grid, an edge-fade mask, a 3D tilt — but **every effect stays clipped inside the card** (`overflow: hidden`).

**Waitlist success card:** `border px-8 py-9`, dark variant `border-white/10 bg-white/[0.04]`; light variant `border-neutral-200 bg-white shadow-[0_2px_24px_rgba(0,0,0,0.05)]`. Includes an oversized watermark icon (`h-60 w-60`, `text-[#a855f7]/[0.15]`) bleeding off the right edge.

### 5.6 Icon buttons (footer social)

`h-12 w-12 flex items-center justify-center border border-white/10 text-white/50` (square). Hover: `hover:border-acid hover:bg-acid hover:text-black hover:shadow-[0_0_24px_-2px_rgba(168,85,247,0.55)]`; inner SVG `group-hover:scale-125 transition-transform`. Sized to snap onto the footer's 52px pixel grid.

### 5.7 Links

- Default muted (`text-white/50` or `text-neutral-*`), `transition-colors duration-200`, hover → `hover:text-acid`.
- Inline text links: `underline decoration-white/20 underline-offset-2 hover:decoration-acid`.
- "Read more" toggle: `font-mono text-xs uppercase tracking-[0.2em]` with a chevron that does `group-hover:animate-arrow-nudge` (rotates 180° when expanded).

### 5.8 Dividers

Gradient hairline: `h-px w-full bg-gradient-to-r from-transparent via-neutral-300 to-transparent` (light) / `via-white/10` (dark). Footer uses solid `border-t border-white/10`.

---

## 6. Iconography

- **Library:** `lucide-react` (e.g. `Check`, `Loader2`, `Heart`, `Mail`). Default `strokeWidth={2}`; thin watermarks use `strokeWidth={1.5}`.
- **Brand glyphs:** lucide dropped brand marks, so social icons are inline `simple-icons` SVG path data (Instagram, YouTube, Facebook, GitHub) on a `0 0 24 24` viewBox, `fill="currentColor"`. Keep these as raw `<path d="…">` constants.
- Heart accent uses `fill-acid text-acid`.
- Chevrons: hand-rolled `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">`.

---

## 7. Motion & Animation

**Global rule:** every animated element must have a `@media (prefers-reduced-motion: reduce)` or `motion-reduce:` fallback, and React components read `useReducedMotion()` from Framer Motion to gate transitions (`reduce ? { duration: 0 } : {...}`).

### 7.1 Framer Motion scroll-reveal (the standard entrance)

```tsx
initial={{ opacity: 0, y: 40 }}
whileInView={{ opacity: 1, y: 0 }}
viewport={{ once: true, margin: "-100px" }}
transition={{ duration: 0.8 }}        // staggered children add delay: 0.2
```
Mockups add a horizontal nudge: `x: reverse ? -20 : 20 → 0`, `duration: 0.6–0.7`, `ease: "easeOut"`.

**Signature easing curve:** `[0.22, 1, 0.36, 1]` (a soft "back-out") for reveals and height expansions.

### 7.2 CSS keyframe animations (in `globals.css` / `FutureSection.css`)

| Name | Class | Duration / timing | Effect |
|---|---|---|---|
| `blob-drift` | `.animate-blob-drift` | `20s ease-in-out infinite` | Slow drift/scale/rotate of gradient blobs |
| `gradient-wave` | `.gradient-wave-text` | `6s linear infinite` | Band of acid sweeps across white text (bg-clip-text) |
| `arrow-nudge` | `.animate-arrow-nudge` | `0.9s ease-in-out infinite` | 2px downward bounce on hover |
| `future-bob` | `.future-bubble` | floats `-5px` | Idle bob |
| `future-caret` | `.future-caret` | `1.05s steps(1) infinite` | Terminal caret blink |
| `rocket-liftoff` | `.rocket-launch` | `7s linear infinite` | Rocket rest → ignition shake → accelerating ascent that recedes/shrinks → resets while invisible |
| `rocket-exhaust` | `.rocket-launch .rocket-exhaust` | `7s linear infinite` | Tapered flame plume synced to the liftoff |

**Gradient-wave text recipe:**
```css
background-image: linear-gradient(100deg, #fff 0%, #fff 35%, var(--color-acid) 50%, #fff 65%, #fff 100%);
background-size: 200% auto;
background-clip: text; -webkit-background-clip: text;
color: transparent; -webkit-text-fill-color: transparent;
animation: gradient-wave 6s linear infinite;
```

### 7.3 Canvas / generative effects (pixel motif)

- **CursorWord** — a fixed full-screen canvas renders a swarm of colored "cursor" sprites that fly in and *spell a word* (the hero's "Store"), hold as readable text for `assembleDelayMs` (hero uses 7000ms), then occasionally morph into a storefront icon. The real text stays in the DOM (transparent, for a11y) with engine-matched `letterSpacing`. Engine is framework-agnostic in `cursorWord/cursorWordEngine.ts`; React component is a thin wrapper. Reduced motion → static text in inherited color.
- **PixelGrid** (footer) — a canvas grid of squares that light up acid near the cursor. `cellSize={52}`, `gap={4}`. The social-button row is JS-snapped to the nearest 52px cell boundary (re-aligned on resize + `document.fonts.ready`).
- **PixelEdge** — jagged run of black squares forming an irregular border at a dark→light section seam (replaces a flat divider).
- **RoadmapTrail** (Future) — a `<canvas>` weaving pixel trail down the section; numbered nodes ride the weave, cards alternate sides (44% width, odd→`flex-start`, even→`flex-end` on `md+`), and the trail passes *behind* opaque cards so each reads as sitting "on the road."

### 7.4 Multi-phase interaction example (Waitlist submit)

1. Submit → `loading` (spinner `Loader2 animate-spin` + "Joining…").
2. Success → checkmark SVG **draws itself** (`pathLength: 0→1`, circle 0.5s then tick at 0.45s delay, spring `stiffness 240 damping 16`).
3. After 1400ms → card slides up (`opacity/y` with `[0.22,1,0.36,1]`, 0.4s) showing confirmation + Instagram CTA. Reduced motion skips straight to the card.

Section transitions in/out use `<AnimatePresence mode="wait">` with `opacity` fades (`duration 0.2–0.25`).

### 7.5 Card-internal effect layers (Future cards)

Stay inside the card; purple appears as *one* accent only.

- **Glow:** `radial-gradient(55% 55% at var(--glow-x,50%) var(--glow-y,55%), rgba(255,255,255,0.07), transparent 70%)`, `blur(36px)`. Accent variant swaps to `rgba(168,85,247,0.65)…`, `blur(52px)`.
- **Dot grid:** `radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1.5px)` at `22px 22px`. Line grid: 1px white/0.05 lines at `2rem 2rem`. Optionally masked with a `--radial` or `--bottom` fade mask.
- **Edge-fade masks:** `mask-image: linear-gradient(to bottom, #000 58%, transparent 100%)` (and a `to bottom right` variant) to dissolve a mockup into the card surface.
- **3D tilt (desktop only):** `transform: perspective(1500px) rotateX(4deg) rotateY(-10deg) rotate(-2deg) scale(0.92)`; upright on mobile. Parent gets `perspective: 1500px`.
- **Corner fade** over a clipped image: stacked linear-gradients from `rgb(6,6,8)` on the right + bottom + bottom-left corner.

---

## 8. Elevation & Effects

| Effect | Value |
|---|---|
| Button glow token | `--shadow-btn-glow: 0 0 30px rgba(168,85,247,0.3)` |
| Icon hover glow | `0 0 24px -2px rgba(168,85,247,0.55)` |
| Light card shadow | `0_2px_24px_rgba(0,0,0,0.05)` |
| Card glow blur | `blur(36px)` neutral / `blur(52px)` accent |
| Seam fade | `bg-gradient-to-b from-black to-transparent h-24` (top of footer) |

Shadows are rare and either purple glows or very soft neutral lifts. No default drop-shadows on cards — depth comes from borders + glows + masks.

---

## 9. Accessibility & Responsive Rules

- **Reduced motion is mandatory** for every animation (see §7). Canvas effects degrade to static.
- **iOS zoom guard:** all text inputs forced to `font-size: 16px`.
- **Focus visibility:** `focus-visible:ring-2 ring-offset-2` (offset color matches the surface: `ring-offset-black` on dark). PixelButton + shadcn both honor `:focus-visible` only (not mouse focus).
- **Hydration safety:** interactive form/button elements carry `suppressHydrationWarning` (form-filler extensions inject `fdprocessedid`). Canvas/MQ components use `useSyncExternalStore` with a `false` server snapshot to keep SSR and first client render in sync.
- **A11y text:** decorative elements `aria-hidden`; real text kept in the DOM even when visually replaced by canvas; icons get `aria-label`; nav landmarks labelled (`aria-label="Explore"` / `"Legal"`).
- **Breakpoints (Tailwind defaults):** `sm 640`, `md 768`, `lg 1024`, `xl 1280`. Type roughly doubles between base and `md`/`lg`. Trail/tilt/alternating layouts engage at `md`+; columns stack and lead with text on mobile.

---

## 10. Voice & Content Rules

- **No em dashes** in copy. Ever.
- **No dates, no "live" claims** in the roadmap/Future section — everything is "planned."
- Founder voice is plain and first-person ("We're four sixteen-year-olds from Europe"), self-correcting, built-in-the-open. Hand font (`font-hand`) reserved for self-corrections.
- Eyebrows are short, uppercase, mono (e.g. "Our Story", "Build your shelf").
- CTAs are direct: "Join the Waitlist", "Be First in Line.", "Read more".
- Numbers as labels are zero-padded (`01`, `02`, `03`) and rendered as giant ghost-grey display numerals.

---

## 11. Quick-Reference Token Sheet

```
ACCENT      #a855f7  (acid)        hover #9333ea
SURFACES    #000000  #0a0a0c  #0a0a0a  rgb(6,6,8)  #ffffff  #F9F9F9
TEXT/DARK   white • white/60 • /50 • /40 • /30
TEXT/LIGHT  neutral-900 • 600 • 500 • 400 • 300/200
BORDERS     white/20 • /18 • /10   |  neutral-300 • 200
RADIUS      0 (brand)   |  rounded-lg (shadcn inputs/buttons only)
FONTS       display: Space Grotesk (900)   body: Geist
            mono: JetBrains Mono            hand: Shadows Into Light
WEIGHT      headings = font-black (900); body = normal
EASE        reveal/expand = cubic-bezier(0.22, 1, 0.36, 1)
REVEAL      opacity 0→1 + y 40→0, dur .8, viewport once margin -100px
PADDING     section py-24 md:py-32 px-6 ; containers max-w-2xl…7xl mx-auto
GLOW        btn 0 0 30px rgba(168,85,247,.3) ; icon 0 0 24px -2px …/.55
MOTIF       squares everywhere; cell unit 52px (footer) / 13px (button)
RULE        one purple accent per surface; reduced-motion fallback always
```

---

## 12. Replication Checklist (for an agent)

1. Set up Next.js App Router + Tailwind v4 + shadcn (dark mode default, `--radius: 0rem`).
2. Self-host the four fonts via `next/font/local`; wire `--font-display/sans/mono/hand` onto `<html class="dark …">`.
3. Add the `@theme` brand tokens (`--color-acid`, surfaces, `--shadow-btn-glow`) and the `.dark` OKLCH overrides.
4. Add globals: smooth scroll, font-smoothing, 16px input guard, custom scrollbar, acid `::selection`, and the keyframes (`blob-drift`, `gradient-wave`, `arrow-nudge`).
5. Build `PixelButton` (square-cell sweep) as the primary CTA; use shadcn Button for secondary.
6. Compose pages as alternating black/light full-bleed sections with `max-w-6xl px-6` containers and the type scale in §3.
7. Add the pixel-motif set: `PixelGrid` footer, `PixelEdge` seams, `CursorWord` hero, `RoadmapTrail`.
8. Use the standard Framer reveal + `[0.22,1,0.36,1]` easing; gate everything behind `useReducedMotion()` / `prefers-reduced-motion`.
9. Keep purple to a single accent per surface; everything else neutral.
10. Enforce copy rules: no em dashes, no dates in roadmap, plain built-in-the-open voice.
```
```
