import type { CSSProperties } from "react";

/**
 * Revenue heroes for the Overview page: the 30-day revenue as one big green
 * number floating over a grainy green bloom.
 *
 * Mobile (below md): the bloom rises from the BOTTOM of the hero — the content
 * sheet below overlaps it with a rounded top, so the glow reads as light
 * escaping from behind the sheet.
 *
 * Desktop (md and up): the hero sits in the first metrics-grid column and the
 * bloom is anchored to the LEFT, bleeding past the cell toward the sidebar and
 * fading out to the right/bottom.
 *
 * The backdrop is decorative code-defined styling in the CardBackdrop mold:
 * a success-green radial fade plus an SVG-turbulence grain layer, both masked
 * to the same shape. Static, aria-hidden.
 */

// rgb(22 163 74) = --color-success. Raw rgba here matches the CardBackdrop
// precedent for decorative alpha layers (tokens have no alpha variants). The
// bloom rises from the BOTTOM-RIGHT and is built from a few offset radial
// blobs of different sizes/alphas, so the light reads as an irregular,
// non-uniform wash rather than a clean symmetric gradient.
const BLOOM = [
  "radial-gradient(90% 85% at 88% 100%, rgba(22,163,74,0.17) 0%, rgba(22,163,74,0.05) 42%, transparent 72%)",
  "radial-gradient(70% 72% at 60% 112%, rgba(22,163,74,0.11) 0%, transparent 58%)",
  "radial-gradient(55% 60% at 104% 84%, rgba(22,163,74,0.09) 0%, transparent 60%)",
].join(", ");

const FADE_MASK =
  "radial-gradient(120% 100% at 80% 100%, #000 0%, #000 46%, transparent 82%)";

const NOISE_TEXTURE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const GRAIN_STYLE: CSSProperties = {
  backgroundImage: NOISE_TEXTURE,
  opacity: 0.26,
  mixBlendMode: "multiply",
  WebkitMaskImage: FADE_MASK,
  maskImage: FADE_MASK,
};

// Desktop bloom: same green family, but rising from the BOTTOM up (like the
// mobile hero) rather than a clean diagonal fade. A few offset blobs of
// different sizes/alphas and slightly different bottom anchors make the wash
// read as irregular and hand-lit, not a symmetric gradient.
const DESKTOP_BLOOM = [
  "radial-gradient(95% 115% at 42% 118%, rgba(22,163,74,0.22) 0%, rgba(22,163,74,0.06) 46%, transparent 74%)",
  "radial-gradient(70% 90% at 12% 108%, rgba(22,163,74,0.13) 0%, transparent 62%)",
  "radial-gradient(60% 80% at 78% 126%, rgba(22,163,74,0.11) 0%, transparent 60%)",
  "radial-gradient(45% 55% at 60% 92%, rgba(22,163,74,0.08) 0%, transparent 58%)",
].join(", ");

const DESKTOP_FADE_MASK =
  "radial-gradient(120% 108% at 42% 112%, #000 0%, #000 44%, transparent 80%)";

const DESKTOP_GRAIN_STYLE: CSSProperties = {
  backgroundImage: NOISE_TEXTURE,
  opacity: 0.42,
  mixBlendMode: "multiply",
  WebkitMaskImage: DESKTOP_FADE_MASK,
  maskImage: DESKTOP_FADE_MASK,
};

export function MobileRevenueHero({ value }: { value: string | null }) {
  return (
    <section
      aria-label="Revenue, last 30 days"
      className="relative -mx-6 -mt-8 px-6 pb-24 pt-20 text-center md:hidden"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 select-none"
        style={{ background: BLOOM }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 select-none"
        style={GRAIN_STYLE}
      />

      <div className="relative">
        {value ? (
          <>
            <p className="text-6xl font-bold tracking-tight text-success">
              {value}
            </p>
            <p className="mt-4 font-inter text-xs text-muted-foreground">
              Revenue · 30 days
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-medium text-muted-foreground">
              No sales yet
            </p>
            <p className="mt-2 font-inter text-xs text-muted-foreground">
              Revenue · 30 days
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Desktop counterpart: replaces the Revenue MetricTile in the first column of
 * the metrics grid from md up. Borderless — the bloom overflows the grid cell
 * (up toward the header, left past the content padding) so it reads as part of
 * the page, not a card.
 */
export function DesktopRevenueHero({ value }: { value: string | null }) {
  return (
    <section
      aria-label="Revenue, last 30 days"
      className="relative hidden flex-col items-center justify-center px-8 py-10 text-center md:flex"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-12 -right-6 -top-6 select-none"
        style={{ background: DESKTOP_BLOOM }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-12 -right-6 -top-6 select-none"
        style={DESKTOP_GRAIN_STYLE}
      />

      <div className="relative">
        {value ? (
          <>
            <p className="text-5xl font-bold tracking-tight text-success lg:text-6xl">
              {value}
            </p>
            <p className="mt-4 font-inter text-sm text-muted-foreground">
              Revenue · 30 days
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-medium text-muted-foreground">
              No sales yet
            </p>
            <p className="mt-2 font-inter text-sm text-muted-foreground">
              Revenue · 30 days
            </p>
          </>
        )}
      </div>
    </section>
  );
}
