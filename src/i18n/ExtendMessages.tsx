"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from "next-intl";

/** Recursively merge `patch` into `base`, returning a new object. */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const b = base[key];
    const p = patch[key];
    if (
      p !== null &&
      typeof p === "object" &&
      !Array.isArray(p) &&
      b !== null &&
      typeof b === "object" &&
      !Array.isArray(b)
    ) {
      result[key] = deepMerge(
        b as Record<string, unknown>,
        p as Record<string, unknown>,
      );
    } else {
      result[key] = p;
    }
  }
  return result;
}

/**
 * Adds one route group's namespaces to the messages the root layout already
 * shipped. Sending the shared shell again from every group would put those
 * strings in the page twice; this way each namespace crosses the wire once.
 *
 * Uses a deep merge so section scopes can add subtrees (e.g. Errors.products)
 * alongside shell subtrees (e.g. Errors.stepUp) without the child entry
 * erasing the sibling from the parent.
 */
export function ExtendMessages({ messages, children }: { messages: Record<string, unknown>; children: ReactNode }) {
  const locale = useLocale();
  const timeZone = useTimeZone();
  const parent = useMessages() as Record<string, unknown>;
  const merged = useMemo(() => deepMerge(parent, messages), [parent, messages]);
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={merged}>
      {children}
    </NextIntlClientProvider>
  );
}
