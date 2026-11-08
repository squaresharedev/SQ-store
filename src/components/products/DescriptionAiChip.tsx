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
 * Shown once there is a title, so a seller knows it is there. Until there is
 * something to write from (canDescribe: a title alone has nothing an honest
 * draft could add), or while the month's credit is spent, it is dimmed and
 * says why on hover and focus, in the words the action would refuse with. A
 * draft that arrives after the seller has typed in the field is dropped: the
 * AI never writes over them.
 */
export function DescriptionAiChip({
  title,
  description,
  facts,
  creditUsed = false,
  onChange,
  suggest = suggestProductDescription,
}: {
  title: string;
  description: string;
  facts: readonly ListingFact[];
  /** The month's AI credit is spent (lib/ai-suggestions.ts aiWritingFor). */
  creditUsed?: boolean;
  onChange: (description: string) => void;
  suggest?: SuggestDescription;
}) {
  const t = useTranslations("Products.form.ai");
  const tErrors = useTranslations("Errors.ai");
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
  if (!busy && !done && !request.title) return null;
  // Why a tap would be refused right now: the spent credit outranks the
  // missing facts, since adding facts would not bring the credit back.
  const blocked =
    busy || done
      ? null
      : creditUsed
        ? `${tErrors("creditUsed.message")} ${tErrors("creditUsed.fix")}`
        : canDescribe(request)
          ? null
          : `${tErrors("tooLittle.message")} ${tErrors("tooLittle.fix")}`;
  if (blocked) {
    return (
      <div className="flex" data-description-ai="">
        <UnavailableChip label={t(mode === "write" ? "write" : "improve")} why={blocked} />
      </div>
    );
  }

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

/** The chip while it cannot be asked: dimmed, but focusable, so the reason
 *  reaches a keyboard and a screen reader as well as a pointer. */
function UnavailableChip({ label, why }: { label: string; why: string }) {
  const whyId = useId();
  return (
    <Tooltip hint label={why} className="max-w-full">
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={whyId}
        className={cn(chipButtonClass, "max-w-full cursor-not-allowed opacity-50 hover:bg-background")}
      >
        <WandSparkles className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </button>
      <span id={whyId} hidden>
        {why}
      </span>
    </Tooltip>
  );
}

/**
 * The same chip on a plan without AI writing help: what Pro would do right
 * here, shown as soon as the real chip would be (once there is a title), and
 * never anything that pops up. It is a link to the plans page in a new tab,
 * so the product being written is not left behind.
 */
export function AiUpsellChip({ title, description }: { title: string; description: string }) {
  const t = useTranslations("Products.form.ai");
  const hintId = useId();
  const mode: DescribeMode = description.trim() ? "improve" : "write";
  if (!title.trim()) return null;
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
