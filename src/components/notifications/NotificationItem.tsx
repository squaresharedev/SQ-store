"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { TYPE_DOT, TYPE_LABEL, formatRelativeTime } from "@/lib/notifications/presentation";
import type { Notification } from "@/lib/notifications/types";

/**
 * One notification row. Renders as a button so the whole row is clickable:
 * clicking marks it read and, if `data.href` is a safe in-app path, navigates
 * there. Title and body are rendered as TEXT only — never as HTML.
 */
export function NotificationItem({
  notification,
  onActivate,
}: {
  notification: Notification;
  /** Called on click with the id and an optional deep-link href. */
  onActivate: (id: string, href: string | null) => void;
}) {
  const router = useRouter();
  const { id, type, title, body, read, created_at, data } = notification;
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
        "transition-colors duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        !read && "bg-accent/40",
      )}
    >
      <span
        aria-hidden
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", TYPE_DOT[type])}
      />
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
            {formatRelativeTime(created_at)}
          </time>
        </span>
        {body && (
          <span className="mt-0.5 block font-inter text-sm text-muted-foreground">
            {body}
          </span>
        )}
        <span className="sr-only">{TYPE_LABEL[type]}</span>
      </span>
      {!read && (
        <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" />
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
  // Must be a root-relative path ("/...") and not "//host" (protocol-relative).
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href;
}
