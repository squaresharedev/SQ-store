"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { transitionClass } from "@/components/ui/control-styles";
import { TYPE_DOT, TYPE_LABEL, formatRelativeTime } from "@/lib/notifications/presentation";
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
 */
export function NotificationItem({
  notification,
  onActivate,
  onActionComplete,
  onNavigate,
}: {
  notification: Notification;
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
    "flex w-full items-start gap-3 px-3 py-3 text-left focus-visible:outline-none",
    // Stretched over the whole row (the action strip included), so any click
    // on the row that is not on the action button opens it. The focus ring is
    // drawn on the same layer, so it frames the whole row too.
    "after:absolute after:inset-0 after:content-['']",
    "focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring",
  );

  const content = (
    <>
      {/* Brand mark as the notification icon; the type colour rides on a dot
          in its corner so the category cue survives. */}
      <span aria-hidden className="relative mt-0.5 size-8 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- static public asset; next/image adds no value here. */}
        <img
          src="/img/logo.png"
          alt=""
          className="size-8 rounded-md border border-border bg-white object-contain"
        />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
            TYPE_DOT[type],
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {title}
          </span>
          <time
            dateTime={created_at}
            suppressHydrationWarning
            className="shrink-0 font-inter text-xs text-muted-foreground"
          >
            {typeof time === "string" ? time : t(time.key, time.values)}
          </time>
        </span>
        {body && (
          <span className="mt-0.5 block font-inter text-sm text-muted-foreground">
            {body}
          </span>
        )}
        <span className="sr-only">{t(TYPE_LABEL[type])}</span>
      </span>
      {!read && (
        <span aria-label={t("Notifications.item.unread")} className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" />
      )}
    </>
  );

  return (
    <div
      data-notification-id={id}
      data-notification-type={type}
      className={cn(
        "relative",
        transitionClass,
        "hover:bg-accent",
        !read && "bg-accent/40",
      )}
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
        // Indented to the text column (icon 2rem + gap 0.75rem + gutter
        // 0.75rem). pointer-events-none on the strip itself, so a click beside
        // the button still falls through to the row link under it.
        <div className="pointer-events-none relative z-10 -mt-1 flex flex-wrap items-center gap-2 pb-3 pl-14 pr-3">
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
