"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { transitionClass } from "@/components/ui/control-styles";
import { iconTileClass } from "@/components/ui/surface-styles";
import { TYPE_ICON, TYPE_LABEL, formatRelativeTime } from "@/lib/notifications/presentation";
import { notificationDestination } from "@/lib/notifications/inline-actions";
import type { Notification } from "@/lib/notifications/types";
import { NotificationInlineAction } from "./NotificationInlineAction";
import { useNotificationText } from "./useNotificationText";

/**
 * One notification row, with two levels of action:
 *
 *  1. The row is a LINK to where the notification's subject lives (its own
 *     `data.href`, or its category's page; see notificationDestination), so
 *     it opens in a new tab like any link. Clicking it marks it read. A row
 *     with nowhere to go is a button that only marks it read.
 *  2. A row that can be acted on in place carries that action under its text
 *     (a team invite's Accept). The link is stretched over the whole row, and
 *     the action sits above it, so the row stays one big target while its
 *     button is still its own control.
 *
 * Title and body are rendered as TEXT only, never as HTML, including when they
 * are resolved from the stored message keys.
 *
 * One attention cue per row: a dot beside the time while it is unread. The
 * category is a monochrome glyph, never a second coloured mark.
 */
export function NotificationItem({
  notification,
  compact = false,
  onActivate,
  onActionComplete,
  onNavigate,
}: {
  notification: Notification;
  /** The bell's dropdown: the body is clamped to two lines, so one long
   *  security notice cannot fill the panel. The full text is on /notifications. */
  compact?: boolean;
  /** Called on click with the id and the destination, if the row has one. */
  onActivate: (id: string, href: string | null) => void;
  /** The row's inline action finished (it is now done, and read). */
  onActionComplete?: (id: string) => void;
  /** The row's inline action is about to leave the page (the dropdown closes). */
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { id, type, read, created_at, data, action } = notification;
  const { title, body } = useNotificationText(notification);
  const locale = useLocale();
  const time = formatRelativeTime(created_at, locale);
  const href = notificationDestination(type, data);
  const Icon = TYPE_ICON[type];

  function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
    onActivate(id, href);
    // A modified or middle click is the browser's (new tab, new window): only
    // a plain click becomes a client-side navigation.
    if (
      !href ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    router.push(href);
  }

  const rowClass = cn(
    "flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:outline-none",
    // Stretched over the whole row (the action strip included), so any click
    // on the row that is not on the action button opens it. The focus ring is
    // drawn on the same layer, so it frames the whole row too.
    "after:absolute after:inset-0 after:content-['']",
    "focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring",
  );

  const content = (
    <>
      <span aria-hidden className={cn(iconTileClass, "mt-0.5 size-8 text-muted-foreground")}>
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-pretty break-words text-sm font-medium text-foreground">
            {title}
          </span>
          {/* The unread dot sits right after the time. Its slot is always
              reserved (empty when read), so times line up across rows. */}
          <span className="flex shrink-0 items-center gap-1.5">
            <time
              dateTime={created_at}
              suppressHydrationWarning
              className="font-inter text-xs text-muted-foreground"
            >
              {typeof time === "string" ? time : t(time.key, time.values)}
            </time>
            <span className="size-2 shrink-0">
              {!read && (
                <span
                  role="img"
                  aria-label={t("Notifications.item.unread")}
                  className="block size-2 rounded-full bg-foreground"
                />
              )}
            </span>
          </span>
        </span>
        {body && (
          <span
            className={cn(
              "mt-0.5 font-inter text-sm text-muted-foreground",
              compact ? "line-clamp-2" : "block",
            )}
          >
            {body}
          </span>
        )}
        <span className="sr-only">{t(TYPE_LABEL[type])}</span>
      </span>
    </>
  );

  return (
    <div
      data-notification-id={id}
      data-notification-type={type}
      className={cn("relative", transitionClass, "hover:bg-accent")}
    >
      {href ? (
        <a href={href} onClick={handleLinkClick} className={rowClass}>
          {content}
        </a>
      ) : (
        <button type="button" onClick={() => onActivate(id, null)} className={rowClass}>
          {content}
        </button>
      )}
      {action && (
        // Indented to the text column (gutter 1rem + icon 2rem + gap 0.75rem).
        // pointer-events-none on the strip itself, so a click beside the
        // button still falls through to the row link under it.
        <div className="pointer-events-none relative z-10 -mt-1 flex flex-wrap items-center gap-2 pb-3 pl-15 pr-4">
          <NotificationInlineAction
            notificationId={id}
            action={action}
            onComplete={onActionComplete}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  );
}
