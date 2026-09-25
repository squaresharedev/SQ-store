"use client";

import type { ReactNode } from "react";
import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from "next-intl";

/**
 * Adds one route group's namespaces to the messages the root layout already
 * shipped. Sending the shared shell again from every group would put those
 * strings in the page twice; this way each namespace crosses the wire once.
 */
export function ExtendMessages({ messages, children }: { messages: Record<string, unknown>; children: ReactNode }) {
  const locale = useLocale();
  const timeZone = useTimeZone();
  const parent = useMessages();
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={{ ...parent, ...messages }}>
      {children}
    </NextIntlClientProvider>
  );
}
