// Pure color math for the ColorPicker. Works in HSV internally (hue 0-360,
// saturation/value 0-100) and only ever PRODUCES strict 6-digit lowercase hex
// (#rrggbb) — the single shape the storefront security contract accepts. No
// alpha, no rgba, no named or free-form CSS color is ever emitted here. No
// React import: safe on client and server.

export type Hsv = { h: number; s: number; v: number };

const HEX = /^#([0-9a-fA-F]{6})$/;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toHex2(channel: number): string {
  return clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0");
}

/** HSV → strict "#rrggbb" (lowercase). Always valid, always 6 digits. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const hue = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = val - c;
  const [r, g, b] =
    hue < 1 ? [c, x, 0] :
    hue < 2 ? [x, c, 0] :
    hue < 3 ? [0, c, x] :
    hue < 4 ? [0, x, c] :
    hue < 5 ? [x, 0, c] :
              [c, 0, x];
  return `#${toHex2((r + m) * 255)}${toHex2((g + m) * 255)}${toHex2((b + m) * 255)}`;
}

/**
 * The relative luminance at which black and white ink have EQUAL WCAG contrast
 * against a background: sqrt(0.05 * 1.05) - 0.05. Above it black wins, below it
 * white wins. Deliberately not 0.5 — luminance is channel-weighted and heavily
 * gamma-compressed, so a naive midpoint calls obviously-light colors (amber,
 * cyan) dark and prints white on them.
 */
const INK_FLIP_LUMINANCE = Math.sqrt(0.05 * 1.05) - 0.05;

/**
 * True when a color is light enough that dark ink reads better on top of it.
 * Uses the WCAG relative-luminance formula, so the check mark drawn over a
 * chosen swatch stays legible on both #fffdf5 and #171717. Returns false for
 * anything that is not strict 6-digit hex.
 */
export function isLightColor(hex: string): boolean {
  const match = HEX.exec(hex);
  if (!match) return false;
  const int = parseInt(match[1], 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > INK_FLIP_LUMINANCE;
}

/**
 * Blend two strict hex colors channel by channel in sRGB space. `amount` 0
 * returns `a`, 1 returns `b`. Used to build a tint (`b = "#ffffff"`) or a
 * shade (`b = "#000000"`) of a color without leaving hex. Either input
 * failing the strict pattern returns `a` unchanged rather than throwing —
 * callers only ever pass strict hex, but a guard here is cheaper than one at
 * every call site.
 */
export function mixHex(a: string, b: string, amount: number): string {
  const ma = HEX.exec(a);
  const mb = HEX.exec(b);
  if (!ma || !mb) return a;
  const ia = parseInt(ma[1], 16);
  const ib = parseInt(mb[1], 16);
  const t = clamp(amount, 0, 1);
  function channel(shift: number): number {
    const ca = (ia >> shift) & 255;
    const cb = (ib >> shift) & 255;
    return ca + (cb - ca) * t;
  }
  return `#${toHex2(channel(16))}${toHex2(channel(8))}${toHex2(channel(0))}`;
}

/** Strict "#rrggbb" → HSV, or null if the string is not 6-digit hex. */
export function hexToHsv(hex: string): Hsv | null {
  const match = HEX.exec(hex);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s: s * 100, v: max * 100 };
}
