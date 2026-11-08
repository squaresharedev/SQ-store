/**
 * The generic half of a lab's model (see ~/.claude/lab.md): what a set of
 * props changed from the component's defaults, that as JSX to paste, and the
 * lab's state in the address bar so a variation can be sent as a link. Each
 * lab keeps its own props type, presets and option lists beside its page.
 */

/** How a lab rates a preset against the brand (docs/styles.md). */
export type LabFit = "on-brand" | "stretch" | "off-brand";

const round = (value: number) => Math.round(value * 1000) / 1000;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What `props` changes from `defaults`, for the copy and the link. */
export function changedProps<T extends object>(defaults: T, props: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (!sameValue(props[key], defaults[key])) out[key] = props[key];
  }
  return out;
}

/** `changed` as a JSX element to paste: `<Name a="x" b={2} />`. */
export function toJsx(name: string, changed: object): string {
  const lines = Object.entries(changed).map(([key, value]) => {
    if (typeof value === "string") return `  ${key}=${JSON.stringify(value)}`;
    if (typeof value === "number") return `  ${key}={${round(value)}}`;
    if (typeof value === "boolean") return `  ${key}={${value}}`;
    return `  ${key}={${JSON.stringify(value, (_, v) => (typeof v === "number" ? round(v) : v))}}`;
  });
  return lines.length ? `<${name}\n${lines.join("\n")}\n/>` : `<${name} />`;
}

/** The address-bar key every lab's state lives under. */
const HASH_KEY = "lab=";

/** A lab's state as the hash it lives in (without the leading `#`). */
export function encodeLabHash(state: unknown): string {
  return HASH_KEY + encodeURIComponent(JSON.stringify(state));
}

/** Back from a hash; null when there is none or it cannot be read. The caller
 *  checks every field it takes out, since a link can carry anything. */
export function decodeLabHash(hash: string): Record<string, unknown> | null {
  const at = hash.indexOf(HASH_KEY);
  if (at < 0) return null;
  try {
    const raw: unknown = JSON.parse(decodeURIComponent(hash.slice(at + HASH_KEY.length)));
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One of `list` at random. */
export const pick = <T,>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)];

/** A number between `min` and `max`, rounded for the link. */
export const between = (min: number, max: number, random: () => number) => round(min + (max - min) * random());
