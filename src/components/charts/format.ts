// Deterministic number formatters — no Intl/locale so server and client
// always render identical text (same rule as the analytics bucket labels).

/** Exact value with thousands separators: 1284 → "1,284". Tooltip/legend tier. */
export function formatNumber(value: number): string {
  const negative = value < 0;
  const [whole, frac] = String(Math.abs(value)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** Compact axis label: 950 → "950", 12_400 → "12.4k", 4_200_000 → "4.2M".
 *  Display-only rounding — exact values render in tooltips via formatNumber. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) return formatNumber(value);
  const sign = value < 0 ? "-" : "";
  const scaled = (n: number) => {
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  if (abs < 1_000_000) return `${sign}${scaled(abs / 1000)}k`;
  if (abs < 1_000_000_000) return `${sign}${scaled(abs / 1_000_000)}M`;
  return `${sign}${scaled(abs / 1_000_000_000)}B`;
}

/** Whole-percent share of a total, safe on zero totals: (3, 12) → "25%". */
export function formatShare(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}
