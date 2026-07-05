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
