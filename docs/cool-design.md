# Square Share — Design System Reference

Purpose of this doc: a catalog of the standout visual elements on squareshare.to, with *why they exist* and *how they're built*, so the same brand language can be reused on the Squareshare dashboard app. This isn't a copy-paste source (the dashboard is a different codebase/app), but every technique below is small enough to reimplement directly.

Brand identity in one line: **pure black + a single acid-purple accent, Space Grotesk display type, and a "pixel/8-bit" motif** (square grids, blocky borders, arrow-cursor glyphs) applied with a very light hand — almost everything is monochrome/neutral, and purple is spent deliberately on 1–2 moments per section, never as decoration everywhere.

---

## 1. Core design tokens

Defined in `src/app/globals.css:12-21` (Tailwind v4 `@theme`, no `tailwind.config.js` — this project is CSS-first):

```css
--color-acid: #a855f7;          /* the ONE accent color, used everywhere consistently */
--color-acid-hover: #9333ea;    /* darker shade for hover/active states */
--color-surface-dark: #000000;  /* true black, not near-black */
--color-surface-light: #F9F9F9; /* off-white for light sections, never pure #fff */
--font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
--font-sans: "Inter"-family (actually Geist, self-hosted), ui-sans-serif, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
--shadow-btn-glow: 0 0 30px rgba(168, 85, 247, 0.3);
```

There's also a rarely-used hand-written font, `--font-hand` (Shadows Into Light), reserved for one "personal voice" moment (founder section annotations) — self-hosted, `preload: false` since it's below the fold (`src/app/layout.tsx:37-43`).

**Rule the whole site follows: purple is a signal, not a theme.** Neutral grays/whites/blacks do 95% of the work; `--color-acid` marks the one interactive/important thing per section (a CTA, a hover state, a single accent glow). Copy this discipline to the dashboard — don't let purple bleed into every icon and border, or it stops meaning anything.

Type scale convention: headings use `font-display` (Space Grotesk) at `font-black` (900) weight with tight `tracking-tight`/`tracking-tighter`, often absurdly large (`text-8xl` on desktop). Overline/eyebrow labels use `font-mono text-xs uppercase tracking-[0.25em]` in a dim white (`text-white/30` to `/50`). Body copy uses the sans font at `text-white/50–60` — text is almost never full-opacity white except headings.

---

## 2. "Our Next Steps" — the roadmap cards + pixel trail

Files: `src/components/FutureSection.tsx`, `src/components/FutureSection.css`, `src/components/future/*`

### 2.1 Purpose
A roadmap section that reads as a physical circuit board: three content cards ("stations") are threaded by one continuous pixel-grid "wire" that a glimmer of light travels along periodically, like current flowing through a trace. It turns a plain "here's our roadmap" list into something that feels alive and engineered, matching the brand's pixel motif, without needing any illustration assets.

### 2.2 The card shell (`.future-card`, `FutureSection.css:53-68`)
This is the reusable card primitive worth lifting directly for dashboard panels:
```css
.future-card {
  border-radius: 0;                              /* sharp corners everywhere — brand signature */
  border: 1px solid rgba(255,255,255,0.1);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02)),
    #0a0a0c;                                       /* opaque near-black, not translucent-over-page */
  transition: border-color 0.3s ease;
}
.future-card:hover { border-color: rgba(255,255,255,0.18); }
```
Key decisions:
- **Zero border-radius.** The whole pixel-brand system uses hard corners (`rounded-none` on buttons, `border-radius: 0` on cards) to contrast with the generic shadcn defaults used elsewhere. This is *the* signature to bring to a dashboard: square cards, not rounded ones, whenever you want the "Squareshare" flavor over generic SaaS.
- A near-invisible top-to-bottom white gradient (4.5% → 2% opacity) over a solid `#0a0a0c`, not `rgba` over black — so content underneath (the trail canvas) is fully hidden by the card and only shows in the gaps between cards. This "card sits on the road" effect is why the trail reads as running *behind* things instead of just being a background image.
- Hover only brightens the border (10% → 18% white), never the fill — keeps hover feedback subtle instead of a jarring highlight.

### 2.3 Card contents — three composable decorations
Every card is built from small aria-hidden, `position:absolute` decoration layers stacked with `z-index`, kept **strictly inside the card's overflow:hidden bounds**. This layering pattern is reusable for any dashboard card:

- **`DotGrid`** (`future/DotGrid.tsx` + `.future-dotgrid*` in the CSS): a faint dot-matrix texture (`radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1.5px)` tiled at `22px 22px`), masked to fade out radially or from the bottom via `mask-image`. Gives a card a subtle "graph paper" backing without a network request or SVG asset — pure CSS.
- **`Glow` / `GlowMock`** (`future/Glow.tsx`, `GlowMock.tsx`): a soft radial blur (`blur(36px)`) positioned behind a mockup via CSS custom properties `--glow-x`/`--glow-y`. Default tone is neutral white (7% opacity); there's a single `tone="accent"` variant that swaps in the acid-purple gradient (`rgba(168,85,247,0.65)` core, `blur(52px)`) — and it's used exactly once across the whole roadmap (behind the marketplace gallery image), reinforcing the "purple = the one important thing" rule.
- **`AngledMock`** (`future/AngledMock.tsx`): tilts a mockup in 3D (`perspective(1500px) rotateX(4deg) rotateY(-10deg) rotate(-2deg) scale(0.92)`, desktop only) and optionally mask-fades one edge into the card background so it looks embedded rather than pasted on top.

### 2.4 The pixel trail (`future/RoadmapTrail.tsx`, ~300 lines, canvas-based)
This is the most technically involved piece. Purpose: draw a Manhattan-routed (right-angle-only) "circuit trace" connecting the three cards, with a traveling glimmer of light that pulses through it periodically — like data flowing through a PCB trace.

How it works, in order:
1. **Layout as a polyline**: computes station card bounding boxes, then builds a path with only horizontal/vertical segments (`RoadmapTrail.tsx:161-169`) — enter card 1 from the top, exit its right edge, run straight down through card 2, jog over, run down to card 3's level, enter its right edge, exit its bottom, fade into the section's padding.
2. **Rasterize to a pixel grid**: the polyline is walked and snapped to a `CELL = 10px` grid, each grid cell becomes a `DOT = 9px` filled square (i.e., a 1px gap between squares) — this is what makes it read as "pixels" rather than a smooth line.
3. **Resting state**: every cell renders at `DIM_ALPHA = 0.14` opacity white — barely visible, just enough to imply a wire.
4. **The glimmer**: an animation loop moves a "head" position along the path's arc-length every `TRAVEL_MS = 2400`ms, then pauses `GAP_MS = 2400`ms before repeating. Each cell's brightness gets a Gaussian falloff around the head position (`GLIMMER_WIDTH = 55px`, peak `+0.85` alpha) — `Math.exp(-(d*d)/(2*W*W))`, so it looks like a soft pulse of light traveling the wire, not a hard-edged marker.
5. **Fades at both ends**: quadratic fade-out as the trail approaches the very top of the section (entering) and the very bottom (exiting into the next section), so the wire dissolves rather than cutting off abruptly.
6. **Perf/accessibility guards**: hidden entirely on mobile (`window.innerWidth < 768`); the whole animation loop is gated on an `IntersectionObserver` (only runs while the section is on-screen) and respects `prefers-reduced-motion` (renders the static dim trail, no animation).

**Why this matters for the dashboard**: this exact pattern — a canvas-drawn pixel-grid connector with a traveling glimmer — is a great way to visually link steps in an onboarding flow, a pipeline/status view, or connect nodes in a workflow builder, while staying entirely on-brand (grid-snapped pixels + one accent color pulse). It's self-contained (one component, takes DOM refs to the "stations" to connect) and doesn't need new assets.

### 2.5 Supporting card content components
- **`TerminalFrame`** (`future/TerminalFrame.tsx`): a fake code-editor/terminal window — traffic-light dots (`bg-white/20`, `/15`, `/10`, no actual colors), a monospace title bar, syntax-token-colored code lines (tags `white/80`, attrs `white/55`, strings `emerald-300/80` — note: no purple in code, keeps code blocks neutral), and a blinking `▍` caret (`@keyframes future-caret`, `steps(1)`, 1.05s). Good template for any dashboard "here's a code snippet / API key / webhook payload" card.
- **`FloatingBubble`** (`future/FloatingBubble.tsx`): a chat-bubble-style chip (icon + title + body) with a gentle idle vertical bob (`@keyframes future-bob`, ±5px, staggered per-item via a `delay` prop) — nice for a stacked list of "coming soon" features or notifications.
- **`MarketplacePanel`**'s image is pinned to the card's bottom-right corner and bleeds past the card edge (`right: -3rem; bottom: -3rem`), then a multi-directional gradient (`future-card-fade`) fades the overflow back into the card's dark background — a cheap way to make a screenshot mockup look "inset" into a card without actually clipping/cropping the source image awkwardly.

---

## 3. The giant background arrow (fills empty space)

File: `src/components/future/MarketplacePanel.tsx:9-38`

### 3.1 Purpose
The marketplace card in the roadmap section has a lot of empty space to its left (it's a right-aligned "station" in the alternating layout). Instead of leaving it blank, a **huge, almost-invisible Lucide arrow icon** sits behind everything, its tail bleeding off the left edge of the viewport and its tip pointing toward the top-right corner — a purely atmospheric background motif that fills dead space without competing with the actual content.

### 3.2 Implementation
```tsx
<div
  className="pointer-events-none absolute hidden md:block"
  style={{ top: "92%", left: "-64rem", transform: "translateY(-50%)", zIndex: 0 }}
  aria-hidden="true"
>
  <svg width="760" height="760" viewBox="0 0 24 24" fill="none"
    stroke="white" strokeWidth="0.65" strokeLinecap="butt" strokeLinejoin="miter"
    style={{ opacity: 0.045 }}>
    <path d="M13 5H19V11" />
    <path d="M19 5L5 19" />
  </svg>
</div>
```
This is literally Lucide's `arrow-up-right` icon path, blown up to `760px`, at **4.5% opacity**, with a hairline `0.65` stroke width (so at that scale it reads as a faint line, not a bold shape) — desktop-only, `pointer-events-none`, `aria-hidden`.

### 3.3 The reusable technique
This is a general-purpose pattern, not specific to arrows:
1. Pick any simple icon (Lucide is already a dependency almost everywhere in this codebase).
2. Blow it up 30–50x normal size (600–800px).
3. Drop stroke opacity to ~3–6% (`0.03`–`0.06`) and use a thin stroke (`0.5`–`1` in the 24×24 viewBox unit).
4. Position it `absolute`, half-bleeding off the container/viewport edge, behind the real content (`z-index: 0` or negative), `pointer-events-none`, `aria-hidden="true"`.
5. Hide it on mobile (`hidden md:block`) — this is decoration, not content, and small screens have no empty space to fill anyway.

**Where to reuse on the dashboard**: any panel/card with a lot of negative space — an empty-state illustration slot, a stats panel with room to spare, a sidebar footer — can get one of these giant faint icons (an arrow for "growth/next", a square/grid glyph to echo the logo, a terminal icon for a dev-tools panel, etc.) instead of leaving it blank or reaching for a stock illustration.

---

## 4. `PixelButton` — the signature interactive primitive

File: `src/components/PixelButton.tsx`

### 4.1 Purpose
The primary CTA button (used for "Join Waitlist" and the waitlist form submit) doesn't do a simple color fade on hover — it fills in with a grid of individual square pixels that sweep in from wherever the cursor entered, like the button is "materializing" out of pixels. This is the single most distinctive interactive element on the site and directly expresses the pixel-art brand identity through *motion*, not just static grids.

### 4.2 How it works
1. On mount/resize, the button measures its own rendered box and snaps its width to a whole multiple of a square cell size (`pixelSize`, default `13px`) so the hover grid tiles perfectly — never a half-cell at the edge.
2. A grid of `cols × rows` absolutely-positioned `<span>`s sits behind the label, each cell a plain filled square (`hoverColor`).
3. On `pointerenter`, it records where the cursor crossed the button edge as a fraction (`fx, fy`) of the box, then computes a per-cell reveal delay: distance from that origin point (normalized so the sweep always finishes in `sweepMs`, default `420ms`) blended with a **seeded** (deterministic, not `Math.random()`) per-cell jitter — `directionalWeight` (default `0.8`) controls how much is "clean radial wipe from the cursor" vs. "random scatter," so the edge of the fill looks broken/pixelated rather than a perfect circle.
4. On `pointerleave`, it re-measures the exit point and reverses — the fill drains back out toward wherever the cursor left, not just fading out uniformly.
5. Label text is two stacked, cross-faded copies (default color + hover color) so text is never briefly black-on-black mid-sweep.
6. Keyboard focus gets the same sweep from a fixed left-edge origin (no pointer position available), and `prefers-reduced-motion` skips the pixel grid entirely in favor of a plain color crossfade.

### 4.3 Reuse for the dashboard
This is a drop-in component (`baseColor`, `hoverColor`, `hoverTextColor`, `pixelSize`, `sweepMs` props) — genuinely portable since it's self-contained React + inline styles, no external CSS file. Good candidates on a dashboard: primary CTA buttons, an "Upgrade" or "Publish" action, anywhere you want one deliberately special button rather than using it everywhere (using it on every button would cheapen the effect — reserve it the same way the marketing site does, for the one primary action per view).

---

## 5. `PixelEdge` — jagged pixel seam between sections

File: `src/components/PixelEdge.tsx`

### 5.1 Purpose
Where the site transitions from a black section to a light (`#F9F9F9`) section, instead of a plain straight horizontal edge, there's a row of black squares of *irregular, randomized height* — like the dark section's floor is crumbling into pixels as it meets the light one. Purely decorative, but it's a cheap, on-brand way to avoid a boring hard line between sections.

### 5.2 How it works
- A `ROWS = 6` tall grid, column count derived from measured container width (`cellSize` px per column, thinner on mobile).
- Each column gets a random "depth" (how many rows down from the top are filled black), generated with a **seeded** pseudo-random function so it's identical on every load (not true `Math.random()` — deterministic and reproducible, which matters for SSR/hydration consistency).
- Adjacent columns' depths are clamped to move at most ±1 (occasionally ±2, 22% of the time) from their neighbor, so the silhouette looks like organic noise rather than either a smooth wave or pure random static — it's "random but locally continuous."
- Every column is solid-filled from the top down to its depth (no floating detached squares), so the top edge stays visually joined to the dark section above it.

### 5.3 Reuse for the dashboard
Anywhere two flat-colored sections meet vertically (e.g., a dark app header giving way to a light content area, or a dark sidebar's bottom edge) — drop this in as the seam instead of a plain `border-top`. It's small, container-width-responsive, and needs zero image assets.

---

## 6. `PixelGrid` — interactive cursor-reactive background grid

File: `src/components/PixelGrid.tsx` — used in the footer (`src/components/Footer.tsx:98-103`)

### 6.1 Purpose
A canvas-rendered grid of small squares covering a whole section, mostly invisible (`rgba(255,255,255,0.022)` resting fill), that lights up in the accent color in a soft radius around the mouse cursor as it moves — like the footer is a sensor panel reacting to your presence. It's the ambient/idle counterpart to `PixelButton`'s active hover sweep.

### 6.2 How it works
- Canvas sized to the parent element; grid cell = `cellSize` (footer uses `52px`) minus a `gap` (footer: `4px`) for the visible dot size.
- Each frame, for cells within `radius` (footer: default `140px`) of the pointer, target brightness = `(1 - distance/radius)^2 * per-cell-jitter` (jitter via a deterministic sine-hash, so the lit blob looks like uneven pixels, not a perfectly smooth circle).
- Brightness eases toward the target: fast rise (`0.3` lerp factor) when brightening, slow decay (`0.06`) when fading — so it snaps to the cursor immediately but leaves a lingering "afterglow" trail as it moves away, rather than tracking rigidly.
- Animation loop only runs while the mouse is active or a trail is still decaying; otherwise it draws the static base grid once and stops (no needless `requestAnimationFrame` churn at idle).
- Fully skipped under `prefers-reduced-motion` (mouse listeners aren't even attached).
- Color is resolved from a CSS custom property (e.g. `var(--color-acid)`) or a literal hex, so it can share the theme token directly.

Notably, in the footer this grid is also used as an **alignment ruler**: the social icon row is JS-snapped (`Footer.tsx:52-89`) to the nearest grid cell boundary on both axes, so the 48px social buttons visually sit exactly on top of lit grid squares — "the UI elements are pixels on the grid" as a layout principle, not just an aesthetic backdrop.

### 6.3 Reuse for the dashboard
Great candidate for an empty dashboard state, a settings page background, or a footer/about panel — anywhere you want a section to feel alive without pulling focus from real content, since it's almost invisible at rest and only responds to direct interaction. Keep the accent color usage rare — this component already resolves `var(--color-acid)` by default, so it plugs into the same token.

---

## 7. `CursorWord` — cursor-swarm text (hero headline)

Files: `src/components/CursorWord.tsx` (wrapper), `src/components/cursorWord/cursorWordEngine.ts` (~1300 lines, framework-agnostic engine), used in `HeroSection.tsx`

### 7.1 Purpose
The word "Store" in the hero headline ("Turn Any Website Into a **Store**") isn't rendered as text — it's spelled out of hundreds of tiny arrow-cursor glyphs (the same Figma-style pointer shape used in `CursorPointer.tsx` and the roadmap's `RoadmapTrail`), packed densely enough to read as solid letterforms. It's the boldest, most literal expression of the brand's "cursor/pointer" motif, directly tying "storefront embed" (which is fundamentally about *other people's visitors clicking*) to the visual language.

### 7.2 How it works (high level — this is a genuinely heavy component, not a quick copy)
1. Renders the target word to an offscreen canvas at the live computed font, reads the alpha mask of filled pixels.
2. Samples that mask into cursor-glyph placement points via two passes: an **edge pass** (evenly-spaced points along the silhouette, so curves read crisply) and an **interior pass** (a quincunx/hex-packed lattice phased to one shared baseline, so every letter's rows align). Includes special handling to keep enclosed counters (the hole in "o"/"e") open rather than solid-filled, by flood-filling from the exterior and eroding ink inward around enclosed regions.
3. Each grid point gets one arrow-cursor glyph (a `Path2D`, the same `M4 2.2 L4 18.8...` pointer shape). Density locks to stroke width (not a fixed budget), so strokes stay a consistent ~3 cursors thick at any screen size.
4. Cursors "assemble" into the word on load (no scattered fly-in intro — starts pre-formed), then loops: hold the word (~3.2s, during which a few cursors peel off to "wander" the page and click on empty space, then return) → morph into a small storefront-icon silhouette (built the same way, procedurally drawn: awning + scalloped valance + building + door + windows) → hold → morph back to the word → repeat.
5. Hovering the formed word triggers a repulsion field around the pointer, scattering nearby cursors, which drift back once the pointer moves away.
6. Adaptive detail tiers based on device capability (`hardwareConcurrency`, `deviceMemory`) — coarser grid and no per-cursor outline on weak/mobile devices; full effect gated behind `prefers-reduced-motion` becoming a static assembled word.

### 7.3 Reuse for the dashboard
This exact engine is overkill to reuse wholesale for a dashboard (it's a hero-moment flourish, not a UI pattern), but the underlying idea scales down nicely: even a **static** arrangement of small arrow-cursor glyphs forming a logotype, icon, or empty-state illustration would read as on-brand without needing the full animation engine. If ever wanted, `cursorWordEngine.ts` is explicitly written to be dependency-free and reusable ("Drop this file into any site" — see its own header comment), so it *can* be lifted directly if a dashboard empty-state or 404 page wants the same "spelled out of cursors" treatment.

---

## 8. Gradient/glow text treatments

### 8.1 `gradient-wave-text` (`src/app/globals.css:124-154`)
A continuous horizontal sweep of the accent color through white text:
```css
background-image: linear-gradient(100deg, #fff 0%, #fff 35%, var(--color-acid) 50%, #fff 65%, #fff 100%);
background-size: 200% auto;
background-clip: text; color: transparent;
animation: gradient-wave 6s linear infinite; /* background-position 200% -> -200% */
```
A simple, cheap way to make a headline word feel "alive" without WebGL — just a moving gradient clipped to text. Respects `prefers-reduced-motion` (animation removed).

### 8.2 `PurposeSection`'s scroll-scrubbed reveal (`src/components/PurposeSection.tsx`)
A large statement sentence ("We exist to give every creator the power to sell anywhere, on their own terms.") reveals **word by word as you scroll past it**, each word driven by Framer Motion's `useScroll`/`useTransform` against its own slice of the scroll range:
- Opacity ramps `0.15 → 1` as each word's slice scrolls through.
- A per-word `accent` value peaks at `1` exactly mid-reveal and returns to `0` once settled — used to drive a **right-edge purple fringe** on that word only while it's actively appearing: a two-layer `background-image` (solid white base + a purple gradient overlay clipped to the same text) plus a `drop-shadow` filter for a subtle glow/fringe on the trailing edge.
- Net effect: each word visibly "catches" a purple highlight as it scrolls into focus, then settles to plain white — never more than one or two words are mid-transition at once.
- Falls back to a simple `whileInView` fade-in on mobile/`prefers-reduced-motion` (per-word scroll scrubbing is expensive to repaint on phones) — a good example of the site's general pattern of **simplifying rather than disabling** motion on constrained devices.

**Reuse for the dashboard**: this scroll-driven "the accent color chases your reading position" technique could work well for a long-form onboarding/changelog page, or a stat/metric callout that animates in as it enters view.

---

## 9. Other reusable moments

- **Oversized icon watermark** (`src/components/WaitlistForm.tsx:181-189`): after a successful signup, the confirmation card shows a giant `Check` icon (Lucide, `h-60 w-60`, `strokeWidth={1.5}`) at ~15–18% accent-color opacity, bleeding off the card's right edge (`-right-10`, vertically centered). Same "huge, faint icon fills dead space" technique as the background arrow (§3), but scoped to a single card rather than a whole section. **This is the most directly reusable pattern for a dashboard**: any success/confirmation state, empty state, or "all done" card can use a giant faint icon (checkmark, box, chart) bleeding off one edge instead of a plain message.
- **Success sequence choreography** (`WaitlistForm.tsx`): on success, a checkmark draws itself in first (`pathLength` animated circle + tick, spring-eased), holds for 1.4s, *then* the confirmation card slides up underneath it — a two-phase reveal rather than everything appearing at once. Good template for a dashboard's own async-action success feedback (e.g., "Payout sent" or "Store published").
- **Floating "island" header** (`src/components/Header.tsx`): the nav bar is never full-bleed — it's a rounded, inset, backdrop-blurred pill (`max-w-4xl`, `rounded-2xl`, margin from every edge) that darkens/gains a border once scrolled (`bg-black/50` → `bg-black/80`). A dashboard top bar could borrow the "floating island, not edge-to-edge" treatment for a lighter, more modern feel than a full-width bar.
- **Read-more arrow nudge** (`globals.css:161-179`, used in `FounderSection.tsx`): a small chevron that idly bounces on hover (`animate-arrow-nudge`, ±2px, 0.9s) and flips 180° when expanded — a tiny detail but consistent with the "small pixel/motion accents on interactive text" language.
- **`SquareShareLogo`** (`src/components/SquareShareLogo.tsx`): the whole brand mark is four flush/offset squares in a 7×7 grid (`shapeRendering="crispEdges"`) — three squares form an "L" (square), a fourth is nudged up-right and disconnected (the "share"/send action). It's the purest distillation of the pixel-grid brand identity and a good visual anchor if the dashboard wants its own mark-derived motifs (e.g., loading spinners or bullet glyphs built from the same square unit).
- **Footer wordmark**: a giant (`clamp(2.5rem, 11vw, 9rem)`) tightly-tracked (`tracking-tighter`, `leading-[0.82]`) uppercase brand name sits below the nav links — an oversized, near-illegible-by-design wordmark as a purely graphic footer element, a common technique worth reusing for a dashboard's own footer/about area.
- **Unused-but-available experiments** (worth knowing about even though not currently rendered on the live site — not imported anywhere in `src/app`): `src/components/SideRays.tsx` and `SoftAurora.tsx` are WebGL (`ogl`) shader backgrounds — light-ray fan and Perlin-noise aurora respectively, both with mouse-reactive uniforms and full prop APIs already built out. `src/components/StorefrontMockup.tsx` is a GSAP-animated floating browser-window mockup of a product grid + checkout button, styled in the same hard-edged/`border-white/10`/acid-accent language as everything else. These are finished, working components sitting in the repo unused on the current page — if the dashboard wants a hero background effect or a "here's what a store looks like" preview card, these are ready to import rather than build from scratch (just verify they still compile against current deps before relying on them, since they're not covered by any current usage/tests).

---

## 10. Principles to carry over (not just components)

1. **Hard corners for brand moments, rounded corners for generic UI.** The shadcn primitives (`Button`, `Card`, `Badge` in `src/components/ui/`) use normal rounded corners — that's the "utility UI" layer. Anything meant to feel like *Squareshare* specifically (roadmap cards, PixelButton, the footer) drops to `border-radius: 0`. Use rounded corners for the dashboard's everyday chrome, and reserve square corners for on-brand moments (a hero stat, a primary CTA, a section that should feel distinctly "Squareshare" rather than "generic dashboard").
2. **One accent color, spent rarely.** Every glow, icon fill, or highlight defaults to neutral (white/gray at low opacity); `--color-acid` appears deliberately, usually once per section/component. Don't let the dashboard reach for purple as a default color — reserve it for the single most important element in a view.
3. **Decorations are `aria-hidden`, `pointer-events-none`, and gated by `prefers-reduced-motion` / mobile checks, consistently.** Every ambient/canvas/WebGL effect in this codebase follows the same accessibility and performance discipline — do the same for any new decorative pixel-grid/glow/arrow additions on the dashboard.
4. **Deterministic "randomness."** Every place that looks random (`PixelEdge`'s jagged columns, `PixelButton`'s scatter jitter, `CursorWord`'s glyph look) actually uses a seeded hash function, not `Math.random()` — so SSR and client render match and reloads look identical. Reuse the same `seededRandom`/`hash01` sine-hash pattern (`x = sin(seed * 12.9898 + k) * 43758.5453; return x - floor(x)`) for any new "organic but reproducible" decoration.
5. **Motion always has a cheap fallback**, not just an on/off switch — mobile and `prefers-reduced-motion` paths generally *simplify* (static grid instead of animated glimmer, single fade instead of per-word scroll-scrub) rather than simply disabling the feature outright.
