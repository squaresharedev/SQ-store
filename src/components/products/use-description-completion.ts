"use client";

import { useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { suggestDescriptionCompletion } from "@/lib/products/describe-actions";
import { canComplete } from "@/lib/suggestions/complete";
import { fitListing, type ListingFact } from "@/lib/suggestions/listing";

/** Failures that will not pass by typing on: said once, and the asking stops
 *  for this visit (the month's credit used, the plan lapsed, a stuck loop). */
const STOPS_ASKING = new Set(["rate_limited", "permission_denied", "session_expired"]);

/** Cache key for one completion ask: title, partial text and all facts joined
 *  with null bytes so adjacent values cannot collide. */
function memoKey(title: string, text: string, facts: readonly ListingFact[]): string {
  return `${title}\0${text}\0${facts.map((f) => `${f.label}\0${f.value}`).join("\0")}`;
}

/**
 * The description field's `suggest` (components/ui/SuggestingTextarea): the
 * next words from suggestDescriptionCompletion, asked only when canComplete
 * says it is worth a call, in the dashboard's language. Null while it is off.
 * Every other failure is a quiet miss: the field just offers nothing.
 *
 * Single-flight: at most one network request is in flight at a time, with one
 * pending slot. A pending ask that is aborted before it starts is dropped
 * without a network call. A session-scoped memo keyed on the exact inputs
 * (title, text and facts) means the same question is never paid for twice.
 */
export function useDescriptionCompletion({
  title,
  facts,
  enabled,
}: {
  title: string;
  facts: readonly ListingFact[];
  enabled: boolean;
}): ((text: string, signal?: AbortSignal) => Promise<string | null>) | null {
  const locale = useLocale();
  const showError = useActionErrorToast();
  const [stopped, setStopped] = useState(false);

  // Session memo: answers already received for identical inputs are reused
  // without a second network call.
  const memo = useRef<Map<string, string | null>>(new Map());
  // Non-null while a request is in flight: its resolve function.
  const inflightRef = useRef<((result: string | null) => void) | null>(null);
  // The next ask to run once the current one settles, or null if none is
  // waiting. Only the most recent pending ask is kept: if a newer one arrives
  // the older pending one is replaced and never sent.
  const pendingRef = useRef<(() => void) | null>(null);

  if (!enabled || stopped) return null;

  return async (text, signal) => {
    const request = fitListing({ title: title.trim(), text, facts: [...facts], language: locale });
    if (!canComplete(request)) return null;

    // Return a memo hit immediately without touching the flight queue.
    const key = memoKey(title.trim(), text, facts);
    if (memo.current.has(key)) return memo.current.get(key) ?? null;

    // If a request is already in flight, queue this one as the pending ask.
    // Any previous pending ask is displaced: at most one waits at a time.
    if (inflightRef.current) {
      return new Promise<string | null>((resolve) => {
        pendingRef.current = () => {
          // If aborted before this pending ask was started, drop it cleanly.
          if (signal?.aborted) { resolve(null); return; }
          resolve(runAsk());
        };
      });
    }

    return runAsk();

    async function runAsk(): Promise<string | null> {
      if (signal?.aborted) return null;

      // Register ourselves as the in-flight request.
      let release!: (result: string | null) => void;
      const inflight = new Promise<string | null>((resolve) => { release = resolve; });
      inflightRef.current = release;

      let completion: string | null = null;
      try {
        const result = await suggestDescriptionCompletion(request);
        if (result.ok) {
          completion = result.completion || null;
        } else if (STOPS_ASKING.has(result.error.code)) {
          setStopped(true);
          showError(result.error);
        }
      } catch {
        // Treat any unexpected error as a quiet miss.
      }

      // Record in memo so an identical ask in this session costs nothing.
      if (!signal?.aborted) memo.current.set(key, completion);

      // Release the in-flight slot.
      inflightRef.current = null;
      release(completion);

      // Start the pending ask if one is waiting.
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) next();

      return inflight;
    }
  };
}
