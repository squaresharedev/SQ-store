// Which stored files a row points at, found by SHAPE rather than by name.
//
// A product or a storefront keeps its files' object keys in several places
// (a column, a gallery, a list of documents, a theme's background, an image
// block, a page's own photo), and that list grows. A deletion that walked a
// fixed list of fields would leave behind the file from whichever field was
// added after it was written. So this walks the whole value and collects every
// string that IS an object key: the shape lib/r2.ts buildObjectKey mints,
// `{images|files|fonts|elements|documents}/{uploader uuid}/{uuid}-{name}`.
//
// Pure and client-safe; the deletion job (./run.ts) is its one caller.

import { UPLOAD_KINDS, objectKeyPrefix } from "@/lib/validation/product";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PREFIXES = UPLOAD_KINDS.map((kind) => objectKeyPrefix(kind)).join("|");

/** An object key exactly as buildObjectKey writes one, and nothing looser: a
 *  string that merely contains a key (a URL, a sentence) is not one. */
const OBJECT_KEY = new RegExp(`^(?:${PREFIXES})/${UUID}/${UUID}-[A-Za-z0-9._-]{1,120}$`);

export function isObjectKey(value: unknown): value is string {
  return typeof value === "string" && OBJECT_KEY.test(value);
}

/** Who uploaded the file an object key names: its second segment. */
export function uploaderOf(key: string): string {
  return key.split("/")[1] ?? "";
}

/**
 * The keys among these that one of `uploaders` uploaded. A row names only its
 * store's own files while every write meets guard_object_keys, but a deletion
 * is where trusting that would cost someone else their file, so the job
 * deletes only what the account or its team uploaded. Any other key is left
 * alone; the row that named it goes anyway.
 */
export function keysUploadedBy(keys: Iterable<string>, uploaders: ReadonlySet<string>): Set<string> {
  return new Set([...keys].filter((key) => uploaders.has(uploaderOf(key))));
}

/** Every object key anywhere inside `value` (a row, a config, a list of rows),
 *  each once. */
export function collectObjectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (isObjectKey(value)) {
    into.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectObjectKeys(entry, into);
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) collectObjectKeys(entry, into);
  }
  return into;
}
