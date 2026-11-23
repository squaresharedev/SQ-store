import type { z } from "zod";

/**
 * Hard cap on repair rounds. Every round removes at least one value, so a
 * stored config always settles long before this; the cap only guarantees the
 * loop ends even if a schema's preprocess keeps putting values back.
 */
export const MAX_REPAIR_ROUNDS = 25;

/** The longest dropped-path list a caller is handed (and so a log line holds). */
const MAX_REPORTED_PATHS = 20;

/** Marks an array item to remove once a round's edits are done. */
const REMOVE = Symbol("remove");

type Path = readonly PropertyKey[];

type Edit =
  | { kind: "drop"; path: Path }
  | { kind: "dropKeys"; path: Path; keys: readonly string[] };

export type RepairedRead<T> = {
  /** The parsed result of the repaired value. */
  data: T;
  /** Where values were dropped, as dotted paths ("blocks.3.type"). Never content. */
  dropped: string[];
};

/**
 * Read a stored value that a NEWER version of the code wrote, by dropping
 * whatever this version's strict schema cannot read instead of rejecting all
 * of it.
 *
 * WHY: stored storefront configs gain optional fields over time and every
 * schema here is strict. After a rollback (or for a stale deploy during a
 * rollout) the older code meets keys, block types and enum members it has
 * never heard of, fails the whole parse, and the designer opens a default
 * board that one save would write over the seller's real design, while the
 * buyer's page and the embed go blank. Dropping the unknown part keeps
 * everything the code does understand.
 *
 * It is a READ-side repair only: writes keep using the strict schema, so
 * nothing unknown is ever stored by this code.
 *
 * The rules, repeated until the value parses or no repair applies:
 * - an unrecognised key is deleted where it stands;
 * - a value the schema rejects is deleted. If the field was optional the
 *   value simply falls back to its default. If it was required, the next
 *   round sees it missing and deletes its parent in turn, so the damage rises
 *   to the nearest array item (a block, a header link) or optional member
 *   that can go;
 * - when that rise reaches the root, nothing is left to invent: null, as a
 *   value the schema never accepted would be.
 *
 * `onlyUnrecognisedKeys` narrows that to the first rule: a value that is
 * known but wrong is never dropped, so a list that gates access (the embed
 * domain allowlist) cannot change meaning by losing an entry.
 *
 * Pure: the input is never modified.
 */
export function repairUnreadable<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  { onlyUnrecognisedKeys = false }: { onlyUnrecognisedKeys?: boolean } = {},
): RepairedRead<z.output<S>> | null {
  if (typeof raw !== "object" || raw === null) return null;

  let value: unknown = structuredClone(raw);
  const dropped: string[] = [];

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    const result = schema.safeParse(value);
    if (result.success) {
      return {
        data: result.data,
        dropped: [...new Set(dropped)].slice(0, MAX_REPORTED_PATHS),
      };
    }

    if (
      onlyUnrecognisedKeys &&
      result.error.issues.some((issue) => issue.code !== "unrecognized_keys")
    ) {
      return null;
    }

    const edits = result.error.issues.flatMap((issue): Edit[] => {
      const path = issue.path;
      if (issue.code === "unrecognized_keys") {
        return [{ kind: "dropKeys", path, keys: issue.keys }];
      }
      // A required value that is missing cannot be dropped again: its parent
      // goes instead (the rise described above).
      if (valueAt(value, path) === undefined) {
        return path.length > 0 ? [{ kind: "drop", path: path.slice(0, -1) }] : [];
      }
      return [{ kind: "drop", path }];
    });

    // The root itself is the problem: nothing is left to drop.
    if (edits.some((edit) => edit.kind === "drop" && edit.path.length === 0)) {
      return null;
    }

    const before = dropped.length;
    for (const edit of edits) applyEdit(value, edit, dropped);
    if (dropped.length === before) return null;
    value = compact(value);
  }
  return null;
}

/** Walk own properties only; undefined as soon as the route is gone. */
function valueAt(root: unknown, path: Path): unknown {
  let node = root;
  for (const key of path) {
    if (node === REMOVE || typeof node !== "object" || node === null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, key)) return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

function applyEdit(root: unknown, edit: Edit, dropped: string[]): void {
  if (edit.kind === "dropKeys") {
    const target = valueAt(root, edit.path);
    if (typeof target !== "object" || target === null || Array.isArray(target)) return;
    for (const key of edit.keys) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
      delete (target as Record<string, unknown>)[key];
      dropped.push(label([...edit.path, key]));
    }
    return;
  }

  const parent = valueAt(root, edit.path.slice(0, -1));
  const key = edit.path[edit.path.length - 1];
  if (typeof parent !== "object" || parent === null) return;
  if (!Object.prototype.hasOwnProperty.call(parent, key)) return;
  if (Array.isArray(parent)) {
    // Removed with the rest of the round's edits, so indexes do not shift
    // under the issues still waiting to be applied.
    (parent as unknown[])[Number(key)] = REMOVE;
  } else {
    delete (parent as Record<PropertyKey, unknown>)[key];
  }
  dropped.push(label(edit.path));
}

/** Remove the items a round marked, wherever they sit. */
function compact(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.filter((item) => item !== REMOVE).map(compact);
  }
  if (typeof node === "object" && node !== null) {
    for (const key of Object.keys(node)) {
      (node as Record<string, unknown>)[key] = compact(
        (node as Record<string, unknown>)[key],
      );
    }
  }
  return node;
}

function label(path: Path): string {
  return path.map(String).join(".");
}
