"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "@/components/ui/AppLink";
import { useTranslations, useLocale } from "next-intl";
import { AlertTriangle, FileSpreadsheet, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast, useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { SaveButton, type SaveResult } from "@/components/ui/SaveButton";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Select } from "@/components/ui/select";
import { Disclosure } from "@/components/ui/Disclosure";
import { AnimatedCheck } from "@/components/ui/animated-check";
import {
  iconTileClass,
  importResultCardClass,
  importResultTitleClass,
} from "@/components/ui/surface-styles";
import {
  errorTextClass,
  ghostDangerButtonClass,
  helpTextClass,
  infoTextClass,
  labelClass,
  primaryButtonClass,
  quietLinkClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { formatBytes } from "@/lib/format";
import { formatCents } from "@/lib/format/money";
import { importProducts, undoProductImport } from "@/lib/products/import-actions";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { plansHref } from "@/lib/billing/paths";
import {
  IMPORT_BYTES_MAX,
  IMPORT_FIELDS_BY_NEED,
  IMPORT_REQUIRED_FIELDS,
  IMPORT_ROWS_MAX,
  buildImportPlan,
  importProblemMessage,
  importableRows,
  parseCsv,
  type ColumnMap,
  type ImportPlan,
  type ImportRow,
} from "@/lib/products/csv";
import { CURRENCIES, PRODUCT_STATUSES, type Currency, type ProductStatus } from "@/types/product";
import { SellerDetailsNotice } from "@/components/settings/SellerDetailsNotice";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import { ConnectAiHint } from "./ConnectAiHint";

/**
 * Moving a catalogue in from somewhere else.
 *
 * THE PREVIEW IS THE POINT. An importer that reports what it did after the
 * fact is a gamble; this one parses the file in the browser and shows the
 * exact rows that will land, with the ones that will not and why, BEFORE
 * anything is written. The file text is what gets sent, and the server parses
 * it again with the same functions, so what is shown here and what is written
 * there cannot drift.
 *
 * The mapping is offered but rarely needed: a Shopify export maps itself, and
 * so does any file whose columns are called roughly what they are. So it stays
 * folded until rows fail for a missing title or price, which is what a wrong
 * mapping looks like.
 *
 * AFTER THE IMPORT the result takes the form's place: what landed, what to do
 * next, and a one-click way to take it all back, which returns to the same
 * file so a wrong currency or column is fixed and imported again.
 */

/** How many preview rows to draw. Enough to trust the mapping without
 *  rendering a 200-row table nobody reads. */
const PREVIEW_ROWS = 8;

type Loaded = { name: string; size: number; text: string };

/** A finished import: what it created, and the lines that go with it. */
type Imported = { ids: string[]; lines: string[]; drafts: boolean };

export function ProductImport({
  missingTraderDetails = [],
  planRoomLeft = null,
  defaultCurrency = "EUR",
  limitNotice = null,
  intro,
}: {
  /** Trader details the store still owes buyers. Non-empty means the server
   *  refuses a live import, so only drafts are offered. */
  missingTraderDetails?: readonly TraderIdentityField[];
  /** How many more products the store's plan has room for; null when nothing
   *  caps it. The server applies the same number: this keeps the preview
   *  honest about which rows will land. */
  planRoomLeft?: number | null;
  /** What the currency starts on: the store's own, else its country's
   *  (lib/predictions.ts, as for a new product). */
  defaultCurrency?: Currency;
  /** Shown in place of the importer while the plan has no room left. Handed
   *  in rather than swapped in by the page: an import that fills the plan
   *  reloads the page, and its result must stay up. */
  limitNotice?: ReactNode;
  /** What a seller reads before choosing a file (what it needs, where to get
   *  it). Shown until a file is picked. */
  intro?: ReactNode;
} = {}) {
  const t = useTranslations("Products.import");
  const tErrors = useTranslations("Errors");
  const tActions = useTranslations("Common.actions");
  const locale = useLocale();
  const toast = useToast();
  const showActionError = useActionErrorToast();
  const resolveMessage = useResolveMessage();

  const [file, setFile] = useState<Loaded | null>(null);
  const [overrides, setOverrides] = useState<Partial<ColumnMap>>({});
  // Once the seller has changed a column, the mapping stays open: fixing the
  // last failing row must not fold it away mid-task.
  const [mappingTouched, setMappingTouched] = useState(false);
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  // Drafts by default: an import is a bulk action, and a mistake that lands
  // live is a mistake buyers can see. The seller publishes when they have
  // looked at what arrived.
  const [status, setStatus] = useState<ProductStatus>("draft");
  // A store that cannot publish imports drafts, whatever was picked.
  const canImportLive = missingTraderDetails.length === 0;
  const importStatus: ProductStatus = canImportLive ? status : "draft";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [imported, setImported] = useState<Imported | null>(null);
  const [undoing, setUndoing] = useState(false);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  // One file carries IMPORT_ROWS_MAX rows, or as many as the plan has room
  // for when that is fewer; which of the two binds decides how it is worded.
  const maxRows = Math.min(IMPORT_ROWS_MAX, planRoomLeft ?? IMPORT_ROWS_MAX);
  const cappedByPlan = planRoomLeft !== null && planRoomLeft < IMPORT_ROWS_MAX;
  const plan: ImportPlan | null = file
    ? buildImportPlan(parseCsv(file.text), overrides, { status: importStatus, maxRows })
    : null;
  const ready = plan ? importableRows(plan) : [];
  const failing = plan ? plan.rows.filter((row) => row.problem !== null) : [];
  const mappingSuspect = failing.some((row) => row.problem === "noTitle" || row.problem === "noPrice");
  const mappedCount = plan ? IMPORT_FIELDS_BY_NEED.filter((field) => plan.columns[field] !== null).length : 0;

  /** One skipped row: its line, its title when it has one, and why. */
  const skippedItem = (row: ImportRow) => (
    <li key={row.line}>
      {row.problem &&
        t("skippedRow", {
          titled: row.title ? "yes" : "no",
          line: row.line,
          title: row.title,
          problem: resolveMessage(importProblemMessage(row.problem)),
        })}
    </li>
  );

  // The result takes the place of the button that was just pressed.
  useEffect(() => {
    if (imported) doneHeadingRef.current?.focus();
  }, [imported]);

  async function load(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    setSaveResult(null);
    if (picked.size > IMPORT_BYTES_MAX) {
      setError(
        t("fileTooLarge", {
          size: formatBytes(picked.size, locale),
          max: formatBytes(IMPORT_BYTES_MAX, locale),
        }),
      );
      return;
    }
    const text = await picked.text();
    if (!text.trim()) {
      setError(t("fileEmpty"));
      return;
    }
    // A fresh file gets a fresh mapping: overrides made against the last
    // file's columns would silently point at the wrong ones here.
    setOverrides({});
    setMappingTouched(false);
    setFile({ name: picked.name, size: picked.size, text });
  }

  async function run() {
    if (!file || ready.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // THE FILE TEXT, not the rows above: the server parses it again, so the
      // preview can never be the thing that decides what is written.
      const result = await importProducts({
        csv: file.text,
        columns: plan?.columns ?? {},
        currency,
        status: importStatus,
      });
      if (!result.ok) {
        setError(resolveMessage(result.error.message));
        setSaveResult({ error: resolveMessage(result.error.message) });
        showActionError(result.error);
        return;
      }
      // The file stays loaded underneath, so taking the import back returns
      // to it ready to fix and import again.
      setImported({
        ids: result.ids,
        drafts: importStatus === "draft",
        lines: [
          ...(result.skipped.length > 0 ? [t("skippedRows", { count: result.skipped.length })] : []),
          // Most of a big import is still waiting on the automatic check when
          // the list loads: said here, so a row of "Checking" badges is expected.
          ...(result.checking > 0 ? [t("checkingRows", { count: result.checking })] : []),
        ],
      });
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!imported || undoing) return;
    setUndoing(true);
    const result = await undoProductImport(imported.ids);
    setUndoing(false);
    if (!result.ok) {
      showActionError(result.error);
      return;
    }
    toast.success(t("undoDone", { count: result.deleted }));
    setImported(null);
  }

  if (imported) {
    const count = imported.ids.length;
    return (
      <section className={importResultCardClass} data-import-done="">
        <div className="flex items-start gap-3">
          <span className={cn(iconTileClass, "size-10")} aria-hidden="true">
            <AnimatedCheck className="size-5" />
          </span>
          <div className="space-y-1" role="status">
            <h2 ref={doneHeadingRef} tabIndex={-1} className={importResultTitleClass}>
              {t("imported", { count })}
            </h2>
            {imported.lines.map((line) => (
              <p key={line} className={helpTextClass}>
                {line}
              </p>
            ))}
            {imported.drafts && (
              <p className={helpTextClass}>
                {t("draftsImportedHint")}
                {count > 1 && (
                  <>
                    {" "}
                    <ConnectAiHint />
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={PRODUCTS_PATH} className={primaryButtonClass}>
            {t("goToProducts")}
          </Link>
          <button type="button" className={ghostDangerButtonClass} onClick={() => void undo()} disabled={undoing}>
            {undoing ? tActions("deleting") : t("undoImport", { count })}
          </button>
        </div>
      </section>
    );
  }

  if (limitNotice) return limitNotice;

  return (
    <div className="space-y-5">
      {!file && intro}
      <FileDropzone
        id="import-file"
        bold
        accept=".csv,text/csv"
        label={file ? file.name : t("dropPrompt")}
        meta={
          file
            ? t("fileMeta", { size: formatBytes(file.size, locale) })
            : t(cappedByPlan ? "planRoom" : "rowsLimit", { max: maxRows })
        }
        onFile={(picked) => void load(picked)}
      />

      {/* Said before a file is picked: for a big shop, adding every photo by
          hand afterwards is the real cost of an import, so it is known first. */}
      <div className="flex items-start gap-3">
        <span className={cn(iconTileClass, "size-8")} aria-hidden="true">
          <ImageOff className="size-4 text-muted-foreground" strokeWidth={2} />
        </span>
        <p className={cn(infoTextClass, "pt-1.5")} data-import-photos-note="">
          {t("photosNotImported")}
        </p>
      </div>

      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}

      {plan && (
        <>
          <div className="flex flex-wrap items-center gap-2" data-import-summary="">
            <span className={cn(iconTileClass, "size-9")}>
              <FileSpreadsheet className="size-4" strokeWidth={2} aria-hidden="true" />
            </span>
            <p className="font-inter text-sm text-foreground">
              {t.rich("summary", {
                shopify: plan.shopify ? "yes" : "no",
                ready: ready.length,
                skipped: failing.length,
                count: (chunks) => <strong className="font-medium">{chunks}</strong>,
              })}
            </p>
          </div>

          {(plan.foldedVariants > 0 || plan.dropped > 0) && (
            <ul className={cn(infoTextClass, "list-disc space-y-1 pl-5")}>
              {plan.foldedVariants > 0 && (
                <li>{t("foldedVariants", { count: plan.foldedVariants })}</li>
              )}
              {plan.dropped > 0 && (
                <li data-import-dropped={cappedByPlan ? "plan" : "file"}>
                  {t(cappedByPlan ? "droppedByPlan" : "droppedRows", { count: plan.dropped, max: maxRows })}
                  {cappedByPlan && (
                    <>
                      {" "}
                      <Link href={plansHref("product_limit")} className={quietLinkClass}>
                        {tErrors("planLimit.action")}
                      </Link>
                    </>
                  )}
                </li>
              )}
            </ul>
          )}

          <div className="grid gap-4 @md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="import-currency" className={labelClass}>
                {t("currency")}
              </label>
              <Select
                id="import-currency"
                value={currency}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                onChange={(value) => setCurrency(value)}
              />
              <p className={helpTextClass}>{t("currencyHelp")}</p>
            </div>
            <div className="space-y-1.5">
              {canImportLive ? (
                <>
                  <label htmlFor="import-status" className={labelClass}>
                    {t("importAs")}
                  </label>
                  <Select
                    id="import-status"
                    value={status}
                    options={PRODUCT_STATUSES.map((value) => ({
                      value,
                      label: value === "draft" ? t("asDrafts") : t("asLive"),
                    }))}
                    onChange={(value) => setStatus(value)}
                  />
                  <p className={helpTextClass}>
                    {status === "draft" ? t("draftsHint") : t("liveHint")}
                  </p>
                </>
              ) : (
                <>
                  <p className={labelClass}>{t("importAs")}</p>
                  <p className="font-inter text-sm text-foreground">{t("asDrafts")}</p>
                  {/* A new tab: following the link here must not throw away
                      the file and the column mapping already done. */}
                  <SellerDetailsNotice
                    missing={missingTraderDetails}
                    blocks="importLiveProducts"
                    detailed={false}
                    newTab
                  />
                </>
              )}
            </div>
          </div>

          <Disclosure
            open={mappingSuspect || mappingTouched}
            summary={
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className={labelClass}>{t("columns")}</span>
                <span className={helpTextClass}>{t("columnsMatched", { count: mappedCount })}</span>
              </span>
            }
            attributes={{ "data-import-columns": "" }}
          >
            <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
              {IMPORT_FIELDS_BY_NEED.map((field) => {
                const selected = plan.columns[field];
                const required = IMPORT_REQUIRED_FIELDS.includes(field);
                return (
                  <div key={field} className="space-y-1.5">
                    <label htmlFor={`import-col-${field}`} className={cn(labelClass, "text-xs")}>
                      {t(`fields.${field}`)}
                      {required && <span className="text-muted-foreground"> {t("needed")}</span>}
                    </label>
                    <Select
                      id={`import-col-${field}`}
                      value={selected === null ? "" : String(selected)}
                      options={[
                        { value: "", label: required ? t("notSet") : t("skip") },
                        ...plan.header.map((name, index) => ({
                          value: String(index),
                          label: name || t("columnFallback", { number: index + 1 }),
                        })),
                      ]}
                      onChange={(value) => {
                        setMappingTouched(true);
                        setOverrides((current) => ({
                          ...current,
                          [field]: value === "" ? null : Number(value),
                        }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </Disclosure>

          {ready.length > 0 && (
            <div className="space-y-2">
              <p className={labelClass}>{t("previewHeading")}</p>
              <div className="overflow-x-auto rounded-sm border border-border">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">{t("previewTitle")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("previewPrice")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("previewStock")}</th>
                    </tr>
                  </thead>
                  <tbody data-import-preview="">
                    {ready.slice(0, PREVIEW_ROWS).map((row) => (
                      <tr key={row.line} className="border-b border-border last:border-b-0">
                        <td className="max-w-[18rem] truncate px-3 py-2">{row.title}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatCents(row.priceCents ?? 0, currency, locale)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {row.stock ?? t("notTracked")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ready.length > PREVIEW_ROWS && (
                <p className={helpTextClass}>
                  {t("andMore", { count: ready.length - PREVIEW_ROWS })}
                </p>
              )}
            </div>
          )}

          {failing.length > 0 && (
            <div className="space-y-2" data-import-skipped="">
              <p className={cn(labelClass, "flex items-center gap-2")}>
                <AlertTriangle className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                {t("skippedHeading")}
              </p>
              <ul className={cn(infoTextClass, "space-y-1")}>
                {failing.slice(0, PREVIEW_ROWS).map(skippedItem)}
                {/* The rest one tap away, so a file with many bad rows can be
                    fixed in one pass rather than eight lines at a time. */}
                {failing.length > PREVIEW_ROWS && (
                  <li>
                    <Disclosure summary={t("andMore", { count: failing.length - PREVIEW_ROWS })}>
                      <ul className="space-y-1">{failing.slice(PREVIEW_ROWS).map(skippedItem)}</ul>
                    </Disclosure>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <SaveButton
              type="button"
              onClick={run}
              disabled={ready.length === 0}
              pending={busy}
              state={saveResult ?? undefined}
              pendingLabel={t("importing")}
            >
              {t("run", { count: ready.length })}
            </SaveButton>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                setFile(null);
                setOverrides({});
                setMappingTouched(false);
                setError(null);
                setSaveResult(null);
              }}
            >
              {t("clear")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
