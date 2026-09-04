"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { SaveButton, type SaveResult } from "@/components/ui/SaveButton";
import { Select } from "@/components/ui/select";
import { iconTileClass } from "@/components/ui/surface-styles";
import {
  errorTextClass,
  helpTextClass,
  infoTextClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { formatBytes } from "@/lib/format";
import { formatCents } from "@/lib/format/money";
import { importProducts } from "@/lib/products/import-actions";
import {
  IMPORT_BYTES_MAX,
  IMPORT_ROWS_MAX,
  buildImportPlan,
  importableRows,
  parseCsv,
  type ColumnMap,
  type ImportField,
  type ImportPlan,
} from "@/lib/products/csv";
import { CURRENCIES, PRODUCT_STATUSES, type Currency, type ProductStatus } from "@/types/product";

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
 * so does any file whose columns are called roughly what they are.
 */

const FIELD_LABELS: Record<ImportField, string> = {
  title: "Title",
  description: "Description",
  price: "Price",
  sku: "SKU",
  stock: "Stock",
};

/** Fields a product cannot be built without, marked so the seller knows which
 *  mapping to fix when rows are failing. */
const REQUIRED_FIELDS: readonly ImportField[] = ["title", "price"];

const ORDERED_FIELDS: readonly ImportField[] = [
  "title",
  "price",
  "description",
  "stock",
  "sku",
];

/** How many preview rows to draw. Enough to trust the mapping without
 *  rendering a 200-row table nobody reads. */
const PREVIEW_ROWS = 8;

type Loaded = { name: string; size: number; text: string };

export function ProductImport() {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<Loaded | null>(null);
  const [overrides, setOverrides] = useState<Partial<ColumnMap>>({});
  const [currency, setCurrency] = useState<Currency>("EUR");
  // Drafts by default: an import is a bulk action, and a mistake that lands
  // live is a mistake buyers can see. The seller publishes when they have
  // looked at what arrived.
  const [status, setStatus] = useState<ProductStatus>("draft");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

  const plan: ImportPlan | null = file
    ? buildImportPlan(parseCsv(file.text), overrides, { status })
    : null;
  const ready = plan ? importableRows(plan) : [];
  const failing = plan ? plan.rows.filter((row) => row.problem !== null) : [];

  async function load(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    setSaveResult(null);
    if (picked.size > IMPORT_BYTES_MAX) {
      setError(
        `That file is ${formatBytes(picked.size)}. Import files up to ${formatBytes(IMPORT_BYTES_MAX)}.`,
      );
      return;
    }
    const text = await picked.text();
    if (!text.trim()) {
      setError("That file is empty.");
      return;
    }
    // A fresh file gets a fresh mapping: overrides made against the last
    // file's columns would silently point at the wrong ones here.
    setOverrides({});
    setFile({ name: picked.name, size: picked.size, text });
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void load(event.dataTransfer.files?.[0]);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    void load(picked);
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
        status,
      });
      if (!result.ok) {
        setError(result.error.message);
        setSaveResult({ error: result.error.message });
        toast.error(result.error.message, {
          lines: result.error.fix ? [result.error.fix] : undefined,
        });
        return;
      }
      setSaveResult({ success: "Imported" });
      toast.success(
        result.imported === 1
          ? "1 product was imported."
          : `${result.imported} products were imported.`,
        {
          lines:
            result.skipped.length > 0
              ? [`${result.skipped.length} row(s) were skipped.`]
              : undefined,
        },
      );
      router.push("/products");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <label
        htmlFor="import-file"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-sm border border-dashed bg-background px-4 py-5 transition-colors duration-base ease-standard motion-reduce:transition-none",
          "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
          dragging ? "border-foreground bg-accent" : "border-border hover:bg-accent",
        )}
      >
        <input
          ref={inputRef}
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={handleChange}
        />
        <span className={cn(iconTileClass, "size-10")}>
          <Upload className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-inter text-sm text-foreground">
            {file ? file.name : "Drop a CSV or click to choose one"}
          </span>
          <span className="block font-inter text-xs text-muted-foreground">
            {file
              ? `${formatBytes(file.size)} · choose another to start over`
              : `Up to ${IMPORT_ROWS_MAX} products per file`}
          </span>
        </span>
      </label>

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
              {plan.shopify ? "Shopify export. " : ""}
              <strong className="font-medium">{ready.length}</strong>{" "}
              {ready.length === 1 ? "product" : "products"} ready
              {failing.length > 0 ? `, ${failing.length} skipped` : ""}.
            </p>
          </div>

          {(plan.foldedVariants > 0 || plan.dropped > 0) && (
            <ul className={cn(infoTextClass, "list-disc space-y-1 pl-5")}>
              {plan.foldedVariants > 0 && (
                <li>
                  {plan.foldedVariants} variant {plan.foldedVariants === 1 ? "row" : "rows"} folded
                  into the products above them. Add sizes and colours after importing.
                </li>
              )}
              {plan.dropped > 0 && (
                <li>
                  {plan.dropped} {plan.dropped === 1 ? "row is" : "rows are"} past the{" "}
                  {IMPORT_ROWS_MAX}-product limit and will not be imported. Split the file to bring
                  {plan.dropped === 1 ? " it" : " them"} in.
                </li>
              )}
            </ul>
          )}

          <p className={infoTextClass}>
            Photos are not imported. Prices, stock and descriptions come across; add the pictures
            once the products are here.
          </p>

          <div className="grid gap-4 @md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="import-currency" className={labelClass}>
                Currency
              </label>
              <Select
                id="import-currency"
                value={currency}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                onChange={(value) => setCurrency(value)}
              />
              <p className={helpTextClass}>Every imported product is priced in this.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="import-status" className={labelClass}>
                Import as
              </label>
              <Select
                id="import-status"
                value={status}
                options={PRODUCT_STATUSES.map((value) => ({
                  value,
                  label: value === "draft" ? "Drafts" : "Live products",
                }))}
                onChange={(value) => setStatus(value)}
              />
              <p className={helpTextClass}>
                {status === "draft"
                  ? "Nothing goes live until you publish it."
                  : "These appear in your store straight away."}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className={labelClass}>Columns</p>
            <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
              {ORDERED_FIELDS.map((field) => {
                const selected = plan.columns[field];
                const required = REQUIRED_FIELDS.includes(field);
                return (
                  <div key={field} className="space-y-1.5">
                    <label htmlFor={`import-col-${field}`} className={cn(labelClass, "text-xs")}>
                      {FIELD_LABELS[field]}
                      {required && <span className="text-muted-foreground"> (needed)</span>}
                    </label>
                    <Select
                      id={`import-col-${field}`}
                      value={selected === null ? "" : String(selected)}
                      options={[
                        { value: "", label: required ? "Not set" : "Skip" },
                        ...plan.header.map((name, index) => ({
                          value: String(index),
                          label: name || `Column ${index + 1}`,
                        })),
                      ]}
                      onChange={(value) =>
                        setOverrides((current) => ({
                          ...current,
                          [field]: value === "" ? null : Number(value),
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {ready.length > 0 && (
            <div className="space-y-2">
              <p className={labelClass}>What will be imported</p>
              <div className="overflow-x-auto rounded-sm border border-border">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Title</th>
                      <th scope="col" className="px-3 py-2 font-medium">Price</th>
                      <th scope="col" className="px-3 py-2 font-medium">Stock</th>
                    </tr>
                  </thead>
                  <tbody data-import-preview="">
                    {ready.slice(0, PREVIEW_ROWS).map((row) => (
                      <tr key={row.line} className="border-b border-border last:border-b-0">
                        <td className="max-w-[18rem] truncate px-3 py-2">{row.title}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatCents(row.priceCents ?? 0, currency)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {row.stock ?? "Not tracked"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ready.length > PREVIEW_ROWS && (
                <p className={helpTextClass}>
                  and {ready.length - PREVIEW_ROWS} more.
                </p>
              )}
            </div>
          )}

          {failing.length > 0 && (
            <div className="space-y-2" data-import-skipped="">
              <p className={cn(labelClass, "flex items-center gap-2")}>
                <AlertTriangle className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                Rows that will be skipped
              </p>
              <ul className={cn(infoTextClass, "space-y-1")}>
                {failing.slice(0, PREVIEW_ROWS).map((row) => (
                  <li key={row.line}>
                    Line {row.line}
                    {row.title ? ` (${row.title})` : ""}: {row.problem}
                  </li>
                ))}
                {failing.length > PREVIEW_ROWS && (
                  <li>and {failing.length - PREVIEW_ROWS} more.</li>
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
              pendingLabel="Importing…"
              savedLabel="Imported"
            >
              {ready.length === 1 ? "Import 1 product" : `Import ${ready.length} products`}
            </SaveButton>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                setFile(null);
                setOverrides({});
                setError(null);
                setSaveResult(null);
              }}
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}
