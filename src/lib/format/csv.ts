/**
 * WRITING CSV for a spreadsheet to open. Pure and client-safe. The reader
 * lives in lib/products/csv.ts (parseCsv); this is the other direction.
 *
 * RFC 4180 as Excel, Numbers and Sheets actually read it:
 *   - a cell holding a comma, a quote or a line break is quoted, with quotes
 *     doubled inside;
 *   - rows end in CRLF;
 *   - the file starts with a UTF-8 byte-order mark, without which Excel reads
 *     "Café" as "CafÃ©".
 *
 * FORMULA INJECTION. A spreadsheet runs a cell that starts with `=`, `+`, `-`,
 * `@`, a tab or a carriage return as a formula, so text a buyer or seller
 * typed ("=HYPERLINK(...)" as a product title) would run on the machine of
 * whoever opens the export. Every TEXT cell that starts with one of those
 * (after any leading spaces) gets a leading apostrophe, which spreadsheets read
 * as "this is text". A plain number ("12.50", "-3") cannot be a formula and is
 * left as it is, so a column of amounts still sums.
 *
 * SEMICOLONS ARE QUOTED TOO. Excel in a comma-decimal locale (Czech, German,
 * Polish, French...) splits a double-clicked CSV on `;`, not `,`. An unquoted
 * `Ada;=HYPERLINK(...)` would become two cells there, the second a formula the
 * guard above never saw at the start of the value. Quoted, it stays one cell.
 */

import { BRAND_NAME } from "@/lib/brand";

/** A cell as the caller has it. Null and undefined are written as empty. */
export type CsvValue = string | number | null | undefined;

/** Put first in a file so Excel reads it as UTF-8. */
export const CSV_BOM = "\uFEFF";

/** The media type a CSV download is served with. */
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

const FORMULA_START = /^[\t\r]|^\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const NEEDS_QUOTES = /[",;\r\n]|^\s|\s$/;

/** What ends every row, the last one included. */
const CSV_ROW_END = "\r\n";

/** One cell, guarded and quoted as needed. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(row: readonly CsvValue[]): string {
  return row.map(csvCell).join(",");
}

/** A whole file: the header, then every row, with the byte-order mark first. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map(csvLine);
  return `${CSV_BOM}${lines.join(CSV_ROW_END)}${CSV_ROW_END}`;
}

/** A file built row by row that never grows past a byte budget. */
export type BoundedCsv = {
  /** Add a row, or refuse it (false) when it would take the file past the
   *  budget. Once one is refused every later row is too, so the file is
   *  always the leading rows, in the order they were offered. */
  add(row: readonly CsvValue[]): boolean;
  /** Rows in the file, the header not counted. */
  readonly rows: number;
  /** The file's size in UTF-8 bytes, byte-order mark included. */
  readonly bytes: number;
  /** The file so far, written exactly as toCsv writes it. */
  toString(): string;
};

/**
 * toCsv for an export whose size must stay bounded whatever the data holds:
 * the file is measured as it is written, in the UTF-8 bytes it will be served
 * as, so a column of long texts in a script of three-byte characters is
 * priced at what it really weighs, not at its length.
 */
export function boundedCsv(header: readonly string[], maxBytes: number): BoundedCsv {
  const encoder = new TextEncoder();
  const lines = [csvLine(header)];
  let bytes = encoder.encode(`${CSV_BOM}${lines[0]}${CSV_ROW_END}`).byteLength;
  let full = false;
  return {
    add(row) {
      if (full) return false;
      const line = csvLine(row);
      const size = encoder.encode(line).byteLength + CSV_ROW_END.length;
      if (bytes + size > maxBytes) {
        full = true;
        return false;
      }
      lines.push(line);
      bytes += size;
      return true;
    },
    get rows() {
      return lines.length - 1;
    },
    get bytes() {
      return bytes;
    },
    toString() {
      return `${CSV_BOM}${lines.join(CSV_ROW_END)}${CSV_ROW_END}`;
    },
  };
}

/** The brand as the first word of every export's file name: "square-share". */
export const CSV_FILE_BRAND = BRAND_NAME.toLowerCase().replace(/\s+/g, "-");

/** "square-share-orders-2026-09-30.csv": an export's download name, dated in UTC. */
export function datedCsvFileName(subject: string, now: Date): string {
  return `${CSV_FILE_BRAND}-${subject}-${now.toISOString().slice(0, 10)}.csv`;
}

/**
 * Integer cents as a plain decimal a spreadsheet sums ("1234" -> "12.34").
 * Integer maths throughout, so no float ever rounds a cent. Two decimals,
 * which is every currency the app sells in today (EUR, USD).
 */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
