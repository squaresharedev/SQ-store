import type en from "../../messages/en";
import { DEFAULT_LOCALE, type Locale } from "./locales";

export type Messages = typeof en;

/**
 * One explicit loader per locale, NOT `import(\`../../messages/${locale}\`)`.
 * A template-literal import is opaque to the Workers bundler; this map keeps
 * each locale its own analysable, lazily loaded chunk.
 */
const LOADERS: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import("../../messages/en"),
  cs: () => import("../../messages/cs"),
  de: () => import("../../messages/de"),
  fr: () => import("../../messages/fr"),
  es: () => import("../../messages/es"),
  it: () => import("../../messages/it"),
  nl: () => import("../../messages/nl"),
  pl: () => import("../../messages/pl"),
  "pt-PT": () => import("../../messages/pt-PT"),
  sk: () => import("../../messages/sk"),
};

/**
 * Merged catalogues, memoised per locale in production only. They are static
 * files identical for every request, so caching them is safe; in development
 * the cache would keep serving a catalogue from before the last edit.
 */
const cache = new Map<Locale, Promise<Messages>>();

/**
 * The catalogue for `locale`, with every key it lacks filled from English.
 *
 * A missing translation therefore renders the English text instead of a raw
 * key or a thrown error. The parity test is what stops that from reaching a
 * release; this is only what keeps a gap from breaking a page.
 */
export function loadMessages(locale: Locale): Promise<Messages> {
  if (process.env.NODE_ENV !== "production") return build(locale);

  let pending = cache.get(locale);
  if (!pending) {
    pending = build(locale);
    // A failed load must not be remembered as the answer forever.
    pending.catch(() => cache.delete(locale));
    cache.set(locale, pending);
  }
  return pending;
}

async function build(locale: Locale): Promise<Messages> {
  const base = (await LOADERS[DEFAULT_LOCALE]()).default as Messages;
  if (locale === DEFAULT_LOCALE) return base;
  const overlay = (await LOADERS[locale]()).default;
  return mergeMessages(base, overlay) as Messages;
}

/** Keys that would reach Object.prototype through a plain assignment. */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Deep-merge a translation over the English catalogue. Only a string may
 * replace a string, and only an object may descend into an object, so a
 * malformed translation file can drop back to English but can never change the
 * catalogue's shape.
 */
export function mergeMessages(base: unknown, overlay: unknown): unknown {
  if (!isRecord(base)) return typeof overlay === typeof base ? overlay : base;
  if (!isRecord(overlay)) return base;

  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (UNSAFE_KEYS.has(key)) continue;
    merged[key] = key in overlay ? mergeMessages(value, overlay[key]) : value;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
