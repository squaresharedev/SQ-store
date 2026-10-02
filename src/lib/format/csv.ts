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
 * whoever opens the export. Every TEXT cell that starts with one of those gets
 * a leading apostrophe, which spreadsheets read as "this is text". A plain
 * number ("12.50", "-3") cannot be a formula and is left as it is, so a column
 * of amounts still sums.
 */

/** A cell as the caller has it. Null and undefined are written as empty. */
export type CsvValue = string | number | null | undefined;

/** Put first in a file so Excel reads it as UTF-8. */
export const CSV_BOM = "\uFEFF";

/** The media type a CSV download is served with. */
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** One cell, guarded and quoted as needed. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: the header, then every row, with the byte-order mark first. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
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
