import type { NotificationType } from "@/lib/notifications/types";

/**
 * Presentation helpers for notifications — kept out of the components so the
 * type→visual mapping and time formatting live in one place. Colors are drawn
 * from semantic tokens only (styles.md): a single small "type dot" per row, no
 * decorative color beyond it.
 */

/** The type dot color. Neutral by default; success/destructive only where it aids scanning. */
export const TYPE_DOT: Record<NotificationType, string> = {
  team: "bg-foreground",
  order: "bg-success",
  payment: "bg-success",
  stock: "bg-destructive",
  system: "bg-muted-foreground",
};

export const TYPE_LABEL: Record<NotificationType, string> = {
  team: "Team",
  order: "Order",
  payment: "Payment",
  stock: "Stock",
  system: "System",
};

const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact relative time: "just now", "5m ago", "3h ago", "2d ago", then an
 * absolute date past a week. Client-safe; render inside a <time> element with
 * `suppressHydrationWarning` since the value depends on the current clock.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now - then;
  if (diff < 45_000) return "just now";
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)}d ago`;
  return ABSOLUTE_DATE.format(then);
}
