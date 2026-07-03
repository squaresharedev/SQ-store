import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Decorative texture that fades into a card from one corner — the light-mode
 * cousin of the marketing site's DotGrid / Glow layers (docs/cool-design.md §2.3).
 *
 * Three on-brand variants:
 *  - `dots`  — faint dot-matrix ("graph paper"), the same motif as the auth
 *              `.dot-grid` backdrop and the pixel logo.
 *  - `grid`  — thin line grid, a calmer alternative for denser cards.
 *  - `glow`  — a soft radial bloom; the ONE sanctioned purple moment (styles.md
 *              §2.4), so `tone="accent"` is reserved for a single hero card.
 *
 * The texture is masked so it is densest at the chosen `corner` and dissolves
 * toward the card interior — it decorates the empty corner without ever sitting
 * under text. Purely decorative: aria-hidden, pointer-events-none, static (no
 * motion, so nothing to gate on reduced-motion).
 *
 * The parent card MUST be `relative overflow-hidden`, and real content should
 * sit in a `relative` wrapper so it stacks above this layer.
 */
export type CardBackdropVariant = "dots" | "grid" | "glow";
/** Corner to bloom from, or `center` for a symmetric fade (empty states). */
export type CardBackdropCorner = "tr" | "tl" | "br" | "bl" | "center";
export type CardBackdropTone = "neutral" | "accent";

const CORNER_POS: Record<CardBackdropCorner, string> = {
  tr: "100% 0%",
  tl: "0% 0%",
  br: "100% 100%",
  bl: "0% 100%",
  center: "50% 50%",
};

// Densest at the anchor, gone toward the far edges.
function fadeMask(corner: CardBackdropCorner): string {
  return corner === "center"
    ? `radial-gradient(ellipse 78% 78% at 50% 50%, #000 0%, #000 12%, transparent 74%)`
    : `radial-gradient(90% 90% at ${CORNER_POS[corner]}, #000 0%, #000 8%, transparent 72%)`;
}

export function CardBackdrop({
  variant = "dots",
  corner = "tr",
  tone = "neutral",
  className,
}: {
  variant?: CardBackdropVariant;
  corner?: CardBackdropCorner;
  /** `accent` = the reserved purple bloom; use on at most one card per view. */
  tone?: CardBackdropTone;
  className?: string;
}) {
  let style: CSSProperties;

  if (variant === "glow") {
    // The radial gradient is itself the fade — no extra mask needed.
    const color =
      tone === "accent" ? "rgba(168, 85, 247, 0.16)" : "rgba(0, 0, 0, 0.05)";
    style = {
      background: `radial-gradient(60% 60% at ${CORNER_POS[corner]}, ${color} 0%, transparent 70%)`,
    };
  } else {
    const ink =
      tone === "accent" ? "rgba(168, 85, 247, 0.22)" : "rgba(0, 0, 0, 0.07)";
    const backgroundImage =
      variant === "dots"
        ? `radial-gradient(${ink} 1px, transparent 1.6px)`
        : `linear-gradient(to right, ${ink} 1px, transparent 1px),
           linear-gradient(to bottom, ${ink} 1px, transparent 1px)`;
    const mask = fadeMask(corner);
    style = {
      backgroundImage,
      backgroundSize: variant === "dots" ? "22px 22px" : "24px 24px",
      WebkitMaskImage: mask,
      maskImage: mask,
    };
  }

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 select-none", className)}
      style={style}
    />
  );
}
