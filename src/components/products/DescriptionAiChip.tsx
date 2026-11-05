"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WandSparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import Link from "@/components/ui/AppLink";
import { chipButtonClass, stubBadgeClass } from "@/components/ui/control-styles";
import { SuggestionChip } from "@/components/ui/SuggestionChip";
import { Tooltip } from "@/components/ui/Tooltip";
import { plansHref } from "@/lib/billing/paths";
import { failure, unexpectedError, type ActionFailure } from "@/lib/errors";
import { suggestProductDescription } from "@/lib/products/describe-actions";
import { canDescribe, type DescribeMode, type DescribeRequest, type ListingFact } from "@/lib/suggestions/describe";
import { fitListing } from "@/lib/suggestions/listing";
import { cn } from "@/lib/utils";

/** How a draft is asked for: the server action, or a stand-in (the lab). */
export type SuggestDescription = (request: DescribeRequest) => Promise<{ ok: true; text: string } | ActionFailure>;

/**
 * AI WRITING HELP for a product's description, a Pro perk: "Write with AI"
 * while the field is empty, "Improve with AI" once it has words. One tap asks;
 * the draft lands in the field, and the curved arrow puts back what was there
 * for as long as the seller has not changed it since. The same chip, rim and
 * hint as every other suggestion (ui/SuggestionChip), so it reads as one more
 * of them, never applied by itself.
 *
 * Offered only when there is something to write from (canDescribe): a title
 * alone has nothing an honest draft could add. A draft that arrives after the
 * seller has typed in the field is dropped: the AI never writes over them.
 */
export function DescriptionAiChip({
  title,
  description,
  facts,
  onChange,
  suggest = suggestProductDescription,
}: {
  title: string;
  description: string;
  facts: readonly ListingFact[];
  onChange: (description: string) => void;
  suggest?: SuggestDescription;
}) {
  const t = useTranslations("Products.form.ai");
  const locale = useLocale();
  const showError = useActionErrorToast();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<{ mode: DescribeMode; before: string; after: string } | null>(null);
  // The field as it is now, for a draft that arrives after a change.
  const latest = useRef(description);
  useEffect(() => {
    latest.current = description;
  });

  // Still exactly as the draft left it: anything typed since and the arrow
  // goes, because taking it back would also take back the seller's own edit.
  const done = applied !== null && applied.after === description;
  const mode: DescribeMode = description.trim() ? "improve" : "write";
  const request: DescribeRequest = fitListing({
    mode,
    title: title.trim(),
    text: description,
    facts: [...facts],
    language: locale,
  });
  if (!busy && !done && (!request.title || !canDescribe(request))) return null;

  async function apply() {
    const before = description;
    setBusy(true);
    let result: Awaited<ReturnType<SuggestDescription>>;
    try {
      result = await suggest(request);
    } catch {
      result = failure(unexpectedError());
    }
    setBusy(false);
    if (latest.current !== before) return;
    if (!result.ok) {
      showError(result.error);
      return;
    }
    setApplied({ mode, before, after: result.text });
    onChange(result.text);
  }

  function undo() {
    if (!applied) return;
    onChange(applied.before);
    setApplied(null);
  }

  const label =
    done && applied
      ? t(applied.mode === "write" ? "written" : "improved")
      : busy
        ? t("writing")
        : t(mode === "write" ? "write" : "improve");

  return (
    <div className="flex" data-description-ai="">
      <SuggestionChip
        icon={WandSparkles}
        label={label}
        hint={t(mode === "write" ? "writeHint" : "improveHint")}
        done={done}
        busy={busy}
        onApply={() => void apply()}
        onUndo={undo}
      />
    </div>
  );
}

/**
 * The same chip on a plan without AI writing help: what Pro would do right
 * here, shown at the moment the real chip would be (a title and something to
 * write from), and never anything that pops up. It is a link to the plans
 * page in a new tab, so the product being written is not left behind.
 */
export function AiUpsellChip({
  title,
  description,
  facts,
}: {
  title: string;
  description: string;
  facts: readonly ListingFact[];
}) {
  const t = useTranslations("Products.form.ai");
  const hintId = useId();
  const mode: DescribeMode = description.trim() ? "improve" : "write";
  if (!title.trim() || !canDescribe({ mode, text: description, facts: [...facts] })) return null;
  return (
    <div className="flex" data-description-ai-upsell="">
      <Tooltip hint label={t("upsellHint")} className="max-w-full">
        <Link
          href={plansHref("ai_writing")}
          target="_blank"
          rel="noopener"
          aria-describedby={hintId}
          className={cn(chipButtonClass, "max-w-full text-muted-foreground")}
        >
          <WandSparkles className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          {t(mode === "write" ? "write" : "improve")}
          <span className={cn(stubBadgeClass, "ml-0.5")}>{t("upsellBadge")}</span>
        </Link>
      </Tooltip>
      <span id={hintId} hidden>
        {t("upsellHint")}
      </span>
    </div>
  );
}
