import {
  CreditCard,
  Gem,
  Info,
  KeyRound,
  Package,
  Receipt,
  Scale,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Locale } from "@/i18n/locales";
import { msg, type MessageKey, type MessageRef } from "@/i18n/types";
import { formatOrderDate } from "@/lib/format/date";
import type { NotificationType } from "@/lib/notifications/types";

/**
 * Presentation helpers for notifications — kept out of the components so the
 * type→visual mapping and time formatting live in one place.
 */

/**
 * The glyph fronting each row, so the category reads at a glance without
 * colour. Monochrome on purpose: the unread dot is the ONE attention cue a row
 * carries, and a coloured category mark beside it made two dots competing for
 * the same glance. Glyphs match the ones the dashboard already uses for the
 * same things (Receipt for orders, as in search; the card and the box, as in
 * the nav).
 */
export const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  team: Users,
  order: Receipt,
  payment: CreditCard,
  stock: Package,
  system: Info,
  // Every security notice is about a credential: a password, a passkey, a
  // recovery code.
  security: KeyRound,
  // A moderation decision, with the statement of reasons it comes with.
  policy: Scale,
  // The seller's own plan, as on the Plan & billing settings page.
  billing: Gem,
};

export const TYPE_LABEL: Record<NotificationType, MessageKey> = {
  team: "Notifications.types.team",
  order: "Notifications.types.order",
  payment: "Notifications.types.payment",
  stock: "Notifications.types.stock",
  system: "Notifications.types.system",
  security: "Notifications.types.security",
  policy: "Notifications.types.policy",
  billing: "Notifications.types.billing",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact relative time: "just now", "5m ago", "3h ago", "2d ago", then an
 * absolute date past a week. Client-safe; render inside a <time> element with
 * `suppressHydrationWarning` since the value depends on the current clock.
 *
 * The relative forms are copy (`Notifications.time`), so they come back as a
 * MessageRef for the render site to resolve in the reader's language. English
 * is a compact form of its own, not Intl.RelativeTimeFormat output, which is
 * why these are messages rather than a formatter. The absolute date is already
 * in the reader's locale.
 */
export function formatRelativeTime(
  iso: string,
  locale: Locale,
  now: number = Date.now(),
): MessageRef | string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now - then;
  if (diff < 45_000) return msg("Notifications.time.justNow");
  if (diff < HOUR) {
    return msg("Notifications.time.minutesAgo", { count: Math.max(1, Math.round(diff / MINUTE)) });
  }
  if (diff < DAY) return msg("Notifications.time.hoursAgo", { count: Math.round(diff / HOUR) });
  if (diff < 7 * DAY) return msg("Notifications.time.daysAgo", { count: Math.round(diff / DAY) });
  return formatOrderDate(iso, locale);
}
