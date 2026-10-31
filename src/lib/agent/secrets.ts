import { OBJECT_KEY_PATTERN } from "@/lib/validation/product";

/**
 * THE LAST CHECK ON EVERYTHING GOING OUT. Tools build their payloads field by
 * field, so nothing here should ever fire. It exists for the day one does not:
 * a new column passed through, a helper that starts returning a key. Fails
 * closed: a result that trips it is refused and logged, not trimmed and sent,
 * because a trimmed result would hide the bug that produced it.
 */

/** Field names that hold a credential or a storage address, in either spelling. */
const FORBIDDEN_FIELDS = new Set([
  "embedKey",
  "embed_key",
  "imageKey",
  "image_key",
  "digitalFileKey",
  "digital_file_key",
  "objectKey",
  "object_key",
  "storedKey",
]);

/** The path of the first secret in `value`, or null when it is clean. */
export function findSecret(value: unknown, path = "$"): string | null {
  if (typeof value === "string") return OBJECT_KEY_PATTERN.test(value) ? path : null;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findSecret(entry, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key)) return `${path}.${key}`;
      const found = findSecret(entry, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}
