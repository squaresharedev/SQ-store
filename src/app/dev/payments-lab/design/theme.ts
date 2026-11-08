import type { CSSProperties } from "react";
import type { LabHero, PaymentsDesignProps } from "../lab-model";

// What the design knobs mean as classes and colours. Lab-only: a winner's
// values become globals.css tokens and surface-styles constants.

const HEX = /^#([0-9a-f]{6})$/i;

/** Relative luminance of a hex colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const match = HEX.exec(hex);
  if (!match) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(match[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDark = (hex: string) => luminance(hex) < 0.18;

/** Near black: an accent that IS the brand ink rather than a deep colour. */
export const isInk = (hex: string) => luminance(hex) < 0.01;

/** The colour pair a design paints with, as custom properties on its root. */
export function designVars(props: PaymentsDesignProps): CSSProperties {
  const second = props.accent2 || `color-mix(in oklab, ${props.accent} 55%, black)`;
  return {
    "--lab-accent": props.accent,
    "--lab-accent-2": second,
    "--lab-accent-soft": `color-mix(in oklab, ${props.accent} 8%, white)`,
    "--lab-accent-line": `color-mix(in oklab, ${props.accent} 28%, white)`,
    "--lab-on-accent": isDark(props.accent) ? "#ffffff" : "#0a0a0a",
  } as CSSProperties;
}

export const pageClass = (props: PaymentsDesignProps) => (props.page === "grey" ? "bg-[#f6f6f7]" : "bg-background");

export const radiusClass = (props: PaymentsDesignProps) =>
  props.radius === "sharp" ? "rounded-none" : props.radius === "soft" ? "rounded-lg" : "rounded-2xl";

/** The inner radius one step down, for things inside a card (avatars, tiles). */
export const innerRadiusClass = (props: PaymentsDesignProps) =>
  props.radius === "sharp" ? "rounded-none" : props.radius === "soft" ? "rounded-md" : "rounded-xl";

/** A content card in the design's style. Padding is the caller's. */
export function cardClass(props: PaymentsDesignProps): string {
  const surface =
    props.cards === "hairline"
      ? "border border-border bg-card"
      : props.cards === "shadow"
        ? "bg-card ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.16)]"
        : props.page === "grey"
          ? "bg-card"
          : "bg-[#f6f6f7]";
  return `${surface} ${radiusClass(props)}`;
}

export const figureClass = (props: PaymentsDesignProps) =>
  ({ medium: "font-medium", semibold: "font-semibold", bold: "font-bold", black: "font-black" })[props.figures];

/** The surface the balance sits on. `dark` says to flip the tokens under it (the `.dark` class). */
export function heroSurface(props: PaymentsDesignProps, hero: LabHero = props.hero): { className: string; style?: CSSProperties; dark: boolean } {
  switch (hero) {
    case "tint":
      return { className: "bg-[var(--lab-accent-soft)] ring-1 ring-[var(--lab-accent-line)]", dark: false };
    case "ink":
      return { className: "bg-neutral-950 text-white ring-1 ring-white/10", dark: true };
    case "gradient":
      return {
        className: "text-[var(--lab-on-accent)]",
        style: {
          background:
            "radial-gradient(120% 140% at 100% 0%, color-mix(in oklab, var(--lab-accent-2) 85%, transparent), transparent 60%), linear-gradient(135deg, var(--lab-accent), color-mix(in oklab, var(--lab-accent) 70%, var(--lab-accent-2)))",
        },
        dark: isDark(props.accent),
      };
    case "mesh":
      return {
        className: "bg-card ring-1 ring-black/[0.06]",
        style: {
          backgroundImage:
            "radial-gradient(60% 90% at 0% 0%, color-mix(in oklab, var(--lab-accent) 22%, transparent), transparent 70%), radial-gradient(50% 80% at 100% 10%, color-mix(in oklab, var(--lab-accent-2) 20%, transparent), transparent 70%), radial-gradient(40% 60% at 60% 120%, color-mix(in oklab, var(--lab-accent) 14%, transparent), transparent 70%)",
        },
        dark: false,
      };
    default:
      return { className: cardClass(props).replace(radiusClass(props), ""), dark: false };
  }
}

/** The chart's colour on a given surface: the accent, unless it would vanish there. */
export function chartColor(props: PaymentsDesignProps, onDark: boolean, hero: LabHero = props.hero): string {
  if (hero === "gradient") return "var(--lab-on-accent)";
  if (onDark && isDark(props.accent)) return props.accent2 && !isDark(props.accent2) ? props.accent2 : "#ffffff";
  return props.accent;
}
