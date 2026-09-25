"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { safeInternalPath } from "@/lib/utils/safe-path";
import { TYPE_DOT, TYPE_LABEL, formatRelativeTime } from "@/lib/notifications/presentation";
import type { Notification } from "@/lib/notifications/types";
import { useNotificationText } from "./useNotificationText";

/**
 * One notification row. Renders as a button so the whole row is clickable:
 * clicking marks it read and, if `data.href` is a safe in-app path, navigates
 * there. Title and body are rendered as TEXT only, never as HTML, including
 * when they are resolved from the stored message keys.
 */
export function NotificationItem({
  notification,
  onActivate,
}: {
  notification: Notification;
  /** Called on click with the id and an optional deep-link href. */
  onActivate: (id: string, href: string | null) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { id, type, read, created_at, data } = notification;
  const { title, body } = useNotificationText(notification);
  const locale = useLocale();
  const time = formatRelativeTime(created_at, locale);
  const href = safeInAppHref(data);

  function handleClick() {
    onActivate(id, href);
    if (href) router.push(href);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left",
        "transition-colors duration-base ease-standard motion-reduce:transition-none",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        !read && "bg-accent/40",
      )}
    >
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
    </button>
  );
}

/**
 * Only allow same-origin, absolute in-app paths from the (server-created) data
 * payload — never an external URL or javascript: scheme. Defense in depth even
 * though the payload is server-authored.
 */
function safeInAppHref(data: Notification["data"]): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const href = (data as Record<string, unknown>).href;
  if (typeof href !== "string") return null;
  // Shared with the auth redirect guard: resolve against a placeholder origin
  // and require it to hold. A prefix check would let "/\t/evil.com" through,
  // which a browser parses as the protocol-relative "//evil.com".
  const safe = safeInternalPath(href, "");
  return safe === "" ? null : safe;
}
