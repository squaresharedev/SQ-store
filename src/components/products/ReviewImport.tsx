"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, MessageSquareQuote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { SaveButton, type SaveResult } from "@/components/ui/SaveButton";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Select } from "@/components/ui/select";
import { iconTileClass } from "@/components/ui/surface-styles";
import { errorTextClass, helpTextClass, infoTextClass, labelClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { formatBytes } from "@/lib/format";
import { REVIEW_IMPORT_API_PATH } from "@/lib/reviews/paths";
import { REVIEW_IMPORT_BYTES_MAX, REVIEW_IMPORT_ROWS_MAX } from "@/lib/reviews/limits";
import { REVIEW_IMPORT_SOURCES, type ReviewImportSource } from "@/lib/reviews/sources";
import {
  buildReviewImportPlan,
  reviewImportProblemMessage,
  reviewProductKeys,
  suggestProductMatches,
  type MatchableProduct,
} from "@/lib/reviews/import";
import { ReviewImportStory } from "./ReviewImportStory";

/**
 * Bringing a store's reviews over from a Shopify review app.
 *
 * Same shape as the product import: the file is parsed HERE for a preview and
 * sent as text, and the server parses it again (app/api/sellers/
 * import-reviews), so what is shown and what is written cannot drift.
 *
 * The one decision the seller makes is WHICH PRODUCT each product in the file
 * is. Each is matched by name where it can be, and every match is a select
 * the seller can correct or set to "Don't import".
 */

type Loaded = { name: string; size: number; text: string };

type ImportReply =
  | { ok: true; imported: number; duplicates: number; skippedCount: number }
  | { ok: false; error: string };

/** The route's refusals, as the catalogue names them; anything else is "failed". */
const IMPORT_ERRORS: Partial<Record<string, "rateLimited" | "tooLarge" | "unrecognised" | "nothing">> = {
  rate_limited: "rateLimited",
  too_large: "tooLarge",
  unrecognised: "unrecognised",
  nothing: "nothing",
};

/** Rows of the mapping table drawn before "and N more". */
const MAPPING_ROWS_SHOWN = 100;
const SKIP = "";

export function ReviewImport({ products }: { products: readonly MatchableProduct[] }) {
  const t = useTranslations("Products.reviewImport");
  // The product importer's words, where they mean the same here.
  const tShared = useTranslations("Products.import");
  const locale = useLocale();
  const toast = useToast();
  const resolveMessage = useResolveMessage();

  const [file, setFile] = useState<Loaded | null>(null);
  const [source, setSource] = useState<ReviewImportSource | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

  const plan = useMemo(() => (file ? buildReviewImportPlan(file.text) : null), [file]);
  const keys = useMemo(() => (plan ? reviewProductKeys(plan) : []), [plan]);
  const suggested = useMemo(() => suggestProductMatches(keys, products), [keys, products]);
  const matches = { ...suggested, ...overrides };
  const chosenSource = source ?? plan?.source ?? null;
  const ready = keys.reduce((sum, key) => sum + (matches[key.slug] ? key.count : 0), 0);
  const failing = plan ? plan.rows.filter((row) => row.problem !== null) : [];
  const productOptions = [
    { value: SKIP, label: t("skipProduct") },
    ...products.map((product) => ({ value: product.id, label: product.title })),
  ];

  function reset() {
    setFile(null);
    setSource(null);
    setOverrides({});
    setError(null);
    setSaveResult(null);
  }

  async function load(picked: File | undefined) {
    if (!picked) return;
    reset();
    if (picked.size > REVIEW_IMPORT_BYTES_MAX) {
      setError(t("fileTooLarge", { max: formatBytes(REVIEW_IMPORT_BYTES_MAX, locale) }));
      return;
    }
    const text = await picked.text();
    if (!text.trim()) {
      setError(t("fileEmpty"));
      return;
    }
    setFile({ name: picked.name, size: picked.size, text });
  }

  async function run() {
    if (!file || !chosenSource || ready === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(REVIEW_IMPORT_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // THE FILE TEXT, not the rows above: the server parses it again.
        body: JSON.stringify({ csv: file.text, fileName: file.name, source: chosenSource, matches }),
      });
      const result = (await response.json().catch(() => null)) as ImportReply | null;
      if (!result?.ok) {
        const message = t(`errors.${IMPORT_ERRORS[result?.error ?? ""] ?? "failed"}`);
        setError(message);
        setSaveResult({ error: message });
        return;
      }
      setSaveResult({ success: tShared("importedLabel") });
      const lines = [
        ...(result.duplicates > 0 ? [t("duplicates", { count: result.duplicates })] : []),
        ...(result.skippedCount > 0 ? [t("skippedRows", { count: result.skippedCount })] : []),
      ];
      toast.success(t("imported", { count: result.imported }), { lines: lines.length > 0 ? lines : undefined });
      setFile(null);
      setOverrides({});
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* What the page does, shown until there is a file to work on. */}
      {!file && <ReviewImportStory />}
      <FileDropzone
        id="review-import-file"
        bold
        accept=".csv,text/csv"
        label={file ? file.name : t("dropPrompt")}
        meta={file ? tShared("fileMeta", { size: formatBytes(file.size, locale) }) : t("rowsLimit", { max: REVIEW_IMPORT_ROWS_MAX })}
        onFile={(picked) => void load(picked)}
      />
      <p className={infoTextClass}>{t("badgeNote")}</p>

      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}

      {plan && plan.missing.length > 0 && (
        <p className={errorTextClass} role="alert" data-review-import-missing="">
          {t("missingColumns", { fields: plan.missing.map((field) => t(`fields.${field}`)).join(", ") })}
        </p>
      )}

      {plan && plan.missing.length === 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2" data-review-import-summary="">
            <span className={cn(iconTileClass, "size-9")}>
              <MessageSquareQuote className="size-4" strokeWidth={2} aria-hidden="true" />
            </span>
            <p className="font-inter text-sm text-foreground">
              {t.rich("summary", {
                ready,
                skipped: plan.rows.length - ready,
                count: (chunks) => <strong className="font-medium">{chunks}</strong>,
              })}
            </p>
          </div>
          {(plan.hidden > 0 || plan.dropped > 0) && (
            <ul className={cn(infoTextClass, "list-disc space-y-1 pl-5")}>
              {plan.hidden > 0 && <li>{t("hiddenRows", { count: plan.hidden })}</li>}
              {plan.dropped > 0 && <li>{t("droppedRows", { count: plan.dropped, max: REVIEW_IMPORT_ROWS_MAX })}</li>}
            </ul>
          )}

          <div className="space-y-1.5 @md:max-w-xs">
            <label htmlFor="review-import-source" className={labelClass}>
              {t("source")}
            </label>
            <Select
              id="review-import-source"
              value={chosenSource ?? ""}
              options={[
                ...(chosenSource ? [] : [{ value: "", label: t("sourceUnknown") }]),
                ...REVIEW_IMPORT_SOURCES.map((value) => ({ value, label: t(`sources.${value}`) })),
              ]}
              onChange={(value) => setSource(value === "" ? null : (value as ReviewImportSource))}
            />
            <p className={helpTextClass}>{t("sourceHelp")}</p>
          </div>

          {keys.length > 0 && (
            <div className="space-y-2">
              <p className={labelClass}>{t("mappingHeading")}</p>
              <p className={helpTextClass}>{t("mappingHelp")}</p>
              <div className="overflow-x-auto rounded-sm border border-border">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">{t("mappingFileProduct")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("mappingReviews")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("mappingProduct")}</th>
                    </tr>
                  </thead>
                  <tbody data-review-import-mapping="">
                    {keys.slice(0, MAPPING_ROWS_SHOWN).map((key, index) => (
                      <tr key={key.slug} className="border-b border-border last:border-b-0">
                        <td className="max-w-[14rem] truncate px-3 py-2">{key.key}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{key.count}</td>
                        <td className="px-3 py-2">
                          <label htmlFor={`review-import-map-${index}`} className="sr-only">
                            {t("mappingSelect", { key: key.key })}
                          </label>
                          <Select
                            id={`review-import-map-${index}`}
                            value={matches[key.slug] ?? SKIP}
                            options={productOptions}
                            onChange={(value) =>
                              setOverrides((current) => ({ ...current, [key.slug]: value === SKIP ? null : value }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {keys.length > MAPPING_ROWS_SHOWN && (
                <p className={helpTextClass}>{tShared("andMore", { count: keys.length - MAPPING_ROWS_SHOWN })}</p>
              )}
            </div>
          )}

          {failing.length > 0 && (
            <div className="space-y-2" data-review-import-skipped="">
              <p className={cn(labelClass, "flex items-center gap-2")}>
                <AlertTriangle className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                {t("skippedHeading")}
              </p>
              <ul className={cn(infoTextClass, "space-y-1")}>
                {failing.slice(0, 8).map((row) => (
                  <li key={row.line}>
                    {row.problem &&
                      t("skippedRow", { line: row.line, problem: resolveMessage(reviewImportProblemMessage(row.problem)) })}
                  </li>
                ))}
                {failing.length > 8 && <li>{tShared("andMore", { count: failing.length - 8 })}</li>}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <SaveButton
              type="button"
              onClick={run}
              disabled={ready === 0 || !chosenSource}
              pending={busy}
              state={saveResult ?? undefined}
              pendingLabel={tShared("importing")}
              savedLabel={tShared("importedLabel")}
            >
              {t("run", { count: ready })}
            </SaveButton>
            <button type="button" className={secondaryButtonClass} onClick={reset}>
              {tShared("clear")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
