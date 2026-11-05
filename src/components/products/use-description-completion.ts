"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { suggestDescriptionCompletion } from "@/lib/products/describe-actions";
import { canComplete } from "@/lib/suggestions/complete";
import { fitListing, type ListingFact } from "@/lib/suggestions/listing";

/** Failures that will not pass by typing on: said once, and the asking stops
 *  for this visit (the month's credit used, the plan lapsed, a stuck loop). */
const STOPS_ASKING = new Set(["rate_limited", "permission_denied", "session_expired"]);

/**
 * The description field's `suggest` (components/ui/SuggestingTextarea): the
 * next words from suggestDescriptionCompletion, asked only when canComplete
 * says it is worth a call, in the dashboard's language. Null while it is off.
 * Every other failure is a quiet miss: the field just offers nothing.
 */
export function useDescriptionCompletion({
  title,
  facts,
  enabled,
}: {
  title: string;
  facts: readonly ListingFact[];
  enabled: boolean;
}): ((text: string) => Promise<string | null>) | null {
  const locale = useLocale();
  const showError = useActionErrorToast();
  const [stopped, setStopped] = useState(false);
  if (!enabled || stopped) return null;
  return async (text) => {
    const request = fitListing({ title: title.trim(), text, facts: [...facts], language: locale });
    if (!canComplete(request)) return null;
    const result = await suggestDescriptionCompletion(request);
    if (result.ok) return result.completion || null;
    if (STOPS_ASKING.has(result.error.code)) {
      setStopped(true);
      showError(result.error);
    }
    return null;
  };
}
