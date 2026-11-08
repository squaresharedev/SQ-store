"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Ban, CircleSlash, CopyCheck, MessageSquareQuote } from "lucide-react";
import Link from "@/components/ui/AppLink";
import { cn } from "@/lib/utils";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { SaveButton, type SaveResult } from "@/components/ui/SaveButton";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Select } from "@/components/ui/select";
import { InfoTip } from "@/components/ui/InfoTip";
import { Disclosure } from "@/components/ui/Disclosure";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { PendingSpinner } from "@/components/ui/PendingSpinner";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { BrandMarkIcon } from "@/components/ui/BrandMarkIcon";
import { StarRating } from "@/components/product-page/StarRating";
import {
  cardClass,
  iconTileClass,
  importResultCardClass,
  importResultTitleClass,
} from "@/components/ui/surface-styles";
import {
  errorTextClass,
  helpTextClass,
  infoTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { formatBytes } from "@/lib/format";
import { formatFixed } from "@/lib/format/intl";
import type { Locale } from "@/i18n/locales";
import { REVIEW_IMPORT_API_PATH, REVIEW_IMPORT_CHECK_API_PATH, REVIEWS_PATH } from "@/lib/reviews/paths";
import { REVIEW_IMPORT_BYTES_MAX, REVIEW_IMPORT_ROWS_MAX } from "@/lib/reviews/limits";
import { REVIEW_IMPORT_SOURCES, type ReviewImportSource } from "@/lib/reviews/sources";
import {
  buildReviewImportPlan,
  reviewFingerprints,
  reviewImportProblemMessage,
  reviewProductKeys,
  slugKey,
  suggestProductMatches,
  type MatchableProduct,
  type ReviewImportPlan,
} from "@/lib/reviews/import";
import { ReviewImportBeams } from "./ReviewImportBeams";

/**
 * Bringing a store's reviews over from a Shopify review app.
 *
 * Same shape as the product import: the file is parsed HERE for a preview and
 * sent as text, and the server parses it again (app/api/sellers/
 * import-reviews), so what is shown and what is written cannot drift.
 *
 * The one decision the seller makes is WHICH PRODUCT each product in the file
 * is. Each is matched by name where it can be, and every match is a picker,
 * with the products' photos, the seller can correct or set to "Don't import".
 *
 * ALREADY HERE. As soon as a file is read, the page asks which of its reviews
 * the store already has (app/api/sellers/import-reviews/check) and counts
 * those apart, so importing the same file again shows up front that nothing
 * will be added twice. The import route checks again before it writes.
 *
 * THIS APP'S OWN EXPORT is told apart and matched by review id, with no app to
 * choose and no products to match, because nothing is ever written from one
 * (lib/reviews/import.ts readSquareShareExport).
 *
 * Numbers first, words on demand: the counts are tiles over one bar, and the
 * explanations sit behind a "?" or a line that opens.
 */

type Loaded = { name: string; size: number; text: string };

type ImportReply =
  | { ok: true; imported: number; duplicates: number; skippedCount: number; hidden: number; dropped: number }
  | { ok: false; error: string };

type CheckReply = { ok: true; existing: { id: string; productId: string }[] } | { ok: false };
type ExportCheckReply = { ok: true; here: string[] } | { ok: false };

/** What the store already has, for one read of a file. `byRow` is null when
 *  the check could not answer: then nothing is counted as already here, and
 *  the import route still keeps it from landing twice. */
type Checked = {
  plan: ReviewImportPlan;
  /** Each row's fingerprints (empty for a row that cannot be imported). */
  ids: string[][];
  /** Each row's products the store already has it on. */
  byRow: ReadonlySet<string>[] | null;
  /** For this app's own export, how many of its reviews are this store's. */
  exportHere: number | null;
};

/** How an import went, for the result card. */
type Done = { imported: number; duplicates: number; leftOut: number };

/** The route's refusals, as the catalogue names them; anything else is "failed". */
const IMPORT_ERRORS: Partial<Record<string, "rateLimited" | "tooLarge" | "unrecognised" | "nothing">> = {
  rate_limited: "rateLimited",
  too_large: "tooLarge",
  unrecognised: "unrecognised",
  nothing: "nothing",
};

/** Rows of the matching list drawn before "and N more". */
const MAPPING_ROWS_SHOWN = 100;
/** Unreadable rows listed by line before "and N more". */
const PROBLEM_ROWS_SHOWN = 8;
const SKIP = "";

/** One fill per kind of count, shared by its tile's icon and its stretch of the bar. */
const TALLY_TONES = {
  ink: "bg-primary text-primary-foreground",
  muted: "bg-muted-foreground text-background",
  faint: "bg-border text-foreground",
} as const;

type TallyItem = {
  id: string;
  icon: ReactNode;
  /** Null while it is still being worked out. */
  value: number | null;
  label: string;
  tone: keyof typeof TALLY_TONES;
};

/** The counts as tiles, and how they share the file as one bar under them. */
function Tally({ items }: { items: readonly TallyItem[] }) {
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-3 gap-2 @md:gap-3">
        {items.map((item) => (
          <li key={item.id} className={cn(cardClass, "flex flex-col gap-2 p-3 @md:p-4")} data-review-import-tally={item.id}>
            <span className={cn(iconTileClass, "size-8", TALLY_TONES[item.tone])} aria-hidden="true">
              {item.icon}
            </span>
            <span className="flex h-8 items-center font-inter text-2xl font-semibold tabular-nums text-foreground">
              {item.value ?? <PendingSpinner pending className="size-5" />}
            </span>
            <span className="font-inter text-xs text-muted-foreground">{item.label}</span>
          </li>
        ))}
      </ul>
      <span aria-hidden="true" className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
        {items.map((item) =>
          item.value ? (
            <span key={item.id} className={cn("h-full", TALLY_TONES[item.tone])} style={{ flexGrow: item.value }} />
          ) : null,
        )}
      </span>
    </div>
  );
}

/** The picker's mark for "Don't import": an empty slot where a photo would be. */
function SkipMark() {
  return (
    <span className="flex size-7 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground">
      <Ban className="size-3.5" strokeWidth={2} />
    </span>
  );
}

const tallyIcon = (Icon: typeof CopyCheck) => <Icon className="size-4" strokeWidth={2} />;

export function ReviewImport({ products }: { products: readonly MatchableProduct[] }) {
  const t = useTranslations("Products.reviewImport");
  // The product importer's words, where they mean the same here.
  const tShared = useTranslations("Products.import");
  const tPage = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const resolveMessage = useResolveMessage();

  const [file, setFile] = useState<Loaded | null>(null);
  const [source, setSource] = useState<ReviewImportSource | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [checked, setChecked] = useState<Checked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  const plan = useMemo(() => (file ? buildReviewImportPlan(file.text) : null), [file]);
  const keys = useMemo(() => (plan ? reviewProductKeys(plan) : []), [plan]);
  const suggested = useMemo(() => suggestProductMatches(keys, products), [keys, products]);
  // Products found by name first. Ordered by the first guess, not the
  // seller's picks, so a row never jumps away while it is being changed.
  const orderedKeys = useMemo(
    () => [...keys].sort((a, b) => Number(!suggested[a.slug]) - Number(!suggested[b.slug])),
    [keys, suggested],
  );
  const matches = useMemo(() => ({ ...suggested, ...overrides }), [suggested, overrides]);
  const chosenSource = source ?? plan?.source ?? null;

  // Ask which of the file's reviews the store already has, once per file.
  useEffect(() => {
    if (!plan || plan.missing.length > 0) return;
    let live = true;
    void (async () => {
      if (plan.squareShare) {
        const { reviewIds } = plan.squareShare;
        let exportHere: number | null = null;
        try {
          const response = await fetch(REVIEW_IMPORT_CHECK_API_PATH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reviewIds }),
          });
          const result = (await response.json().catch(() => null)) as ExportCheckReply | null;
          if (result?.ok) {
            const here = new Set(result.here);
            exportHere = reviewIds.filter((id) => here.has(id)).length;
          }
        } catch {
          // Unanswered: the page says so rather than guessing either way.
        }
        if (live) setChecked({ plan, ids: [], byRow: null, exportHere });
        return;
      }
      let ids: string[][] = plan.rows.map(() => []);
      let byRow: ReadonlySet<string>[] | null = null;
      try {
        // Hashing needs a secure context; without one there is no answer either.
        ids = await Promise.all(plan.rows.map((row) => (row.problem === null ? reviewFingerprints(row) : [])));
        const response = await fetch(REVIEW_IMPORT_CHECK_API_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: ids.flat() }),
        });
        const result = (await response.json().catch(() => null)) as CheckReply | null;
        if (result?.ok) {
          const onProducts = new Map<string, Set<string>>();
          for (const { id, productId } of result.existing) {
            onProducts.set(id, (onProducts.get(id) ?? new Set<string>()).add(productId));
          }
          byRow = ids.map((rowIds) => new Set(rowIds.flatMap((id) => [...(onProducts.get(id) ?? [])])));
        }
      } catch {
        // Unanswered: count nothing as already here; the import still checks.
      }
      if (live) setChecked({ plan, ids, byRow, exportHere: null });
    })();
    return () => {
      live = false;
    };
  }, [plan]);

  const check = checked?.plan === plan ? checked : null;

  // Every row, sorted into what happens to it under the current matching.
  const tally = useMemo(() => {
    const perKey = new Map<string, number>();
    const fresh = new Set<string>();
    let ready = 0;
    let already = 0;
    let unmatched = 0;
    for (const [index, row] of (plan?.rows ?? []).entries()) {
      if (row.problem !== null) continue;
      const slug = slugKey(row.productKey);
      const productId = matches[slug];
      if (!productId) {
        unmatched += 1;
        continue;
      }
      // Already in the store, or a second copy of a row above it in this file.
      const identity = `${productId}:${check?.ids[index]?.[0] ?? index}`;
      if (check?.byRow?.[index]?.has(productId) || fresh.has(identity)) {
        already += 1;
        perKey.set(slug, (perKey.get(slug) ?? 0) + 1);
        continue;
      }
      fresh.add(identity);
      ready += 1;
    }
    return { ready, already, unmatched, perKey };
  }, [plan, check, matches]);

  const exported = plan?.squareShare ?? null;
  const exportHere = check?.exportHere ?? null;
  const alreadyHere = tally.already + (exportHere ?? 0);
  // Only once the check has answered: until then nobody knows whose they are.
  const notInStore = exported && exportHere !== null ? exported.reviewIds.length - exportHere + exported.unreadable : 0;
  const failing = plan ? plan.rows.filter((row) => row.problem !== null) : [];
  const leftOut = tally.unmatched + notInStore + failing.length + (plan?.hidden ?? 0) + (plan?.dropped ?? 0);
  const checking = !check;

  const productOptions = [
    { value: SKIP, label: t("skipProduct"), leading: <SkipMark /> },
    ...products.map((product) => ({
      value: product.id,
      label: product.title,
      leading: <ProductThumb src={product.imageUrl} className="size-7" />,
    })),
  ];

  // The result card takes the place of the button that was just pressed.
  useEffect(() => {
    if (done) doneHeadingRef.current?.focus();
  }, [done]);

  function reset() {
    setFile(null);
    setSource(null);
    setOverrides({});
    setChecked(null);
    setError(null);
    setSaveResult(null);
    setDone(null);
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
    if (!file || !chosenSource || tally.ready === 0) return;
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
      setFile(null);
      setOverrides({});
      setDone({
        imported: result.imported,
        duplicates: result.duplicates,
        leftOut: result.skippedCount + result.hidden + result.dropped,
      });
    } catch {
      setError(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const landed = done.imported > 0;
    return (
      <section className={importResultCardClass} data-review-import-result={landed ? "imported" : "nothing"}>
        <div className="flex items-start gap-3">
          <span className={cn(iconTileClass, "size-10", landed ? TALLY_TONES.ink : TALLY_TONES.muted)} aria-hidden="true">
            {landed ? <AnimatedCheck className="size-5" /> : <CopyCheck className="size-5" strokeWidth={2} />}
          </span>
          <div className="space-y-1" role="status">
            <h2 ref={doneHeadingRef} tabIndex={-1} className={importResultTitleClass}>
              {landed ? t("done.title", { count: done.imported }) : t("done.nothingTitle")}
            </h2>
            <p className={helpTextClass}>
              {landed ? t("done.body") : t("done.nothingBody", { count: done.duplicates })}
              {landed && done.duplicates > 0 && <> {t("done.already", { count: done.duplicates })}</>}
            </p>
          </div>
        </div>
        <Tally
          items={[
            { id: "imported", icon: tallyIcon(MessageSquareQuote), value: done.imported, label: t("tally.imported"), tone: "ink" },
            { id: "already", icon: tallyIcon(CopyCheck), value: done.duplicates, label: t("tally.already"), tone: "muted" },
            { id: "leftOut", icon: tallyIcon(CircleSlash), value: done.leftOut, label: t("tally.leftOut"), tone: "faint" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Link href={REVIEWS_PATH} className={primaryButtonClass}>
            {t("done.seeReviews")}
          </Link>
          <button type="button" className={secondaryButtonClass} onClick={reset}>
            {t("done.another")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6" data-review-import="">
      {/* What the page does, shown until there is a file to work on. */}
      {!file && <ReviewImportBeams />}
      <FileDropzone
        id="review-import-file"
        bold
        accept=".csv,text/csv"
        label={file ? file.name : t("dropPrompt")}
        meta={file ? tShared("fileMeta", { size: formatBytes(file.size, locale) }) : t("rowsLimit", { max: REVIEW_IMPORT_ROWS_MAX })}
        onFile={(picked) => void load(picked)}
      />

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
          <div className="space-y-3" data-review-import-summary="">
            {exported && (
              <div className="flex items-center gap-3 font-inter text-sm font-medium text-foreground" data-review-import-square-share="">
                <span className={cn(iconTileClass, "size-9", TALLY_TONES.ink)} aria-hidden="true">
                  <BrandMarkIcon className="size-4" />
                </span>
                {t("squareShare.label")}
                <InfoTip label={t("squareShare.tipLabel")}>{t("squareShare.tip")}</InfoTip>
              </div>
            )}
            <Tally
              items={[
                { id: "ready", icon: tallyIcon(MessageSquareQuote), value: checking ? null : tally.ready, label: t("tally.toImport"), tone: "ink" },
                { id: "already", icon: tallyIcon(CopyCheck), value: checking ? null : alreadyHere, label: t("tally.already"), tone: "muted" },
                { id: "leftOut", icon: tallyIcon(CircleSlash), value: leftOut, label: t("tally.leftOut"), tone: "faint" },
              ]}
            />
            {alreadyHere > 0 && (
              <p className="flex items-center gap-3 font-inter text-sm text-foreground" role="status" data-review-import-already="">
                <span className={cn(iconTileClass, "size-9", TALLY_TONES.muted)} aria-hidden="true">
                  <CopyCheck className="size-4" strokeWidth={2} />
                </span>
                {t("alreadyNote", { count: alreadyHere })}
              </p>
            )}
            {exported && check && exportHere === null && (
              <p className={errorTextClass} role="alert" data-review-import-check-failed="">
                {t("squareShare.checkFailed")}
              </p>
            )}
          </div>

          {!exported && (
            <div className="space-y-1.5 @md:max-w-xs">
              <div className="flex items-center gap-1.5">
                <label htmlFor="review-import-source" className={labelClass}>
                  {t("source")}
                </label>
                <InfoTip label={t("sourceTip")}>{t("badgeNote")}</InfoTip>
              </div>
              <Select
                id="review-import-source"
                value={chosenSource ?? ""}
                options={[
                  ...(chosenSource ? [] : [{ value: "", label: t("sourceUnknown") }]),
                  ...REVIEW_IMPORT_SOURCES.map((value) => ({ value, label: t(`sources.${value}`) })),
                ]}
                onChange={(value) => setSource(value === "" ? null : (value as ReviewImportSource))}
              />
            </div>
          )}

          {keys.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <p className={labelClass}>{t("mappingHeading")}</p>
                <InfoTip label={t("mappingTip")}>{t("mappingHelp")}</InfoTip>
              </div>
              <ul className="divide-y divide-border rounded-sm border border-border" data-review-import-mapping="">
                {orderedKeys.slice(0, MAPPING_ROWS_SHOWN).map((key, index) => {
                  const matched = Boolean(matches[key.slug]);
                  const keyAlready = tally.perKey.get(key.slug) ?? 0;
                  return (
                    <li
                      key={key.slug}
                      className={cn(
                        "grid gap-2.5 p-3 @md:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1.25fr)] @md:items-center @md:gap-4",
                        !matched && "bg-muted/40",
                      )}
                      data-review-import-key={key.slug}
                    >
                      <div className="min-w-0 space-y-1">
                        <p
                          className={cn(
                            "truncate font-inter text-sm font-medium",
                            matched ? "text-foreground" : "text-muted-foreground",
                          )}
                          title={key.key}
                        >
                          {key.key}
                        </p>
                        <p className="flex items-center gap-2 font-inter text-xs text-muted-foreground">
                          <StarRating
                            value={key.average}
                            label={tPage("average", { average: formatFixed(key.average, 1, locale) })}
                          />
                          <span className="tabular-nums">{t("reviewCount", { count: key.count })}</span>
                        </p>
                      </div>
                      <ArrowRight className="hidden size-4 text-muted-foreground @md:block" strokeWidth={2} aria-hidden="true" />
                      <div className="min-w-0 space-y-1.5">
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
                        {matched && keyAlready > 0 && (
                          <p className={cn(infoTextClass, "flex items-center gap-1.5")} data-review-import-key-already={keyAlready}>
                            <CopyCheck className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                            {t("keyAlready", { count: keyAlready })}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {keys.length > MAPPING_ROWS_SHOWN && (
                <p className={helpTextClass}>{tShared("andMore", { count: keys.length - MAPPING_ROWS_SHOWN })}</p>
              )}
            </div>
          )}

          {leftOut > 0 && (
            <Disclosure
              icon={CircleSlash}
              summary={t("leftOutSummary", { count: leftOut })}
              className={infoTextClass}
              attributes={{ "data-review-import-skipped": "" }}
            >
              <ul className="list-disc space-y-1.5 pl-4">
                {tally.unmatched > 0 && <li>{t("leftOutUnmatched", { count: tally.unmatched })}</li>}
                {notInStore > 0 && <li>{t("squareShare.leftOut", { count: notInStore })}</li>}
                {plan.hidden > 0 && <li>{t("leftOutHidden", { count: plan.hidden })}</li>}
                {plan.dropped > 0 && (
                  <li>{t("leftOutDropped", { count: plan.dropped, max: REVIEW_IMPORT_ROWS_MAX })}</li>
                )}
                {failing.length > 0 && (
                  <li>
                    {t("leftOutProblems", { count: failing.length })}
                    <ul className="mt-1 space-y-1" data-review-import-problems="">
                      {failing.slice(0, PROBLEM_ROWS_SHOWN).map((row) => (
                        <li key={row.line}>
                          {row.problem &&
                            t("skippedRow", { line: row.line, problem: resolveMessage(reviewImportProblemMessage(row.problem)) })}
                        </li>
                      ))}
                      {failing.length > PROBLEM_ROWS_SHOWN && (
                        <li>{tShared("andMore", { count: failing.length - PROBLEM_ROWS_SHOWN })}</li>
                      )}
                    </ul>
                  </li>
                )}
              </ul>
            </Disclosure>
          )}

          <div className="flex items-center gap-3">
            <SaveButton
              type="button"
              onClick={run}
              disabled={checking || tally.ready === 0 || !chosenSource}
              pending={busy}
              state={saveResult ?? undefined}
              pendingLabel={tShared("importing")}
              savedLabel={tShared("importedLabel")}
            >
              {!checking && tally.ready === 0 && (alreadyHere > 0 || exported) ? t("nothingNew") : t("run", { count: tally.ready })}
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
