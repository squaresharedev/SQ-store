"use client";

import { useMemo } from "react";
import { createTranslator, useLocale, useMessages, useTimeZone } from "next-intl";
import {
  storedNotificationMessage,
  type NotificationMessageRef,
} from "@/lib/notifications/message";
import type { Notification } from "@/lib/notifications/types";

export type NotificationText = { title: string; body: string | null };

/**
 * A notification's title and body in the reader's language, from the keys in
 * `data.message`, or the stored English when that is missing or unusable.
 *
 * Resolved through a translator of its own rather than the shared `t`, because
 * the shared one answers a formatting failure (a stored value the message does
 * not expect, or one it needs and was not given) by returning the raw key. This
 * one reports the failure, and the stored text is shown instead.
 */
export function useNotificationText(
  notification: Pick<Notification, "title" | "body" | "data">,
): NotificationText {
  const locale = useLocale();
  const messages = useMessages();
  const timeZone = useTimeZone();
  const { title, body, data } = notification;

  return useMemo(() => {
    const stored = storedNotificationMessage(data);
    if (!stored) return { title, body };

    function resolve(ref: NotificationMessageRef, fallback: string): string {
      let failed = false;
      const t = createTranslator({
        locale,
        messages,
        timeZone,
        onError: () => {
          failed = true;
        },
        getMessageFallback: () => "",
      });
      if (!t.has(ref.key)) return fallback;
      const text = t(ref.key, ref.values);
      return failed || text === "" ? fallback : text;
    }

    return {
      title: resolve(stored.title, title),
      body: stored.body ? resolve(stored.body, body ?? "") || null : body,
    };
  }, [locale, messages, timeZone, title, body, data]);
}
