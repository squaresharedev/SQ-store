import { sha256Hex } from "@/lib/agent/oauth/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { OBJECT_KEY_PATTERN } from "@/lib/validation/product";

/**
 * OBJECT KEYS NEVER CROSS THE AGENT BOUNDARY (docs/agent-surface.md, B6), yet an
 * assistant has to be able to read a storefront and save it back with its photos
 * still on it. So on the way out each key becomes an opaque handle, and on the
 * way in each handle becomes a key again:
 *
 *   ref:<hash>      a key this store already uses, as read. A handle only
 *                   resolves against the record being saved, so a hash from
 *                   somewhere else can never name another seller's file.
 *   upload:<uuid>   a file uploaded through an assistant (agent_uploads),
 *                   belonging to this same connection.
 *
 * Keys are found by what they ARE, not by which field holds them: a config
 * member added later cannot leak one by default.
 */

const REF_PREFIX = "ref:";
const UPLOAD_PREFIX = "upload:";
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long an uploaded file can wait to be attached to something. */
export const AGENT_UPLOAD_SECONDS = 24 * 60 * 60;

type Json = unknown;

function isObjectKey(value: string): boolean {
  return OBJECT_KEY_PATTERN.test(value);
}

async function refFor(key: string): Promise<string> {
  return `${REF_PREFIX}${(await sha256Hex(key)).slice(0, 32)}`;
}

async function walk(value: Json, map: (text: string) => Promise<string>): Promise<Json> {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return Promise.all(value.map((entry) => walk(entry, map)));
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, entry]) => [key, await walk(entry, map)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/** A copy of `value` with every object key replaced by its handle. */
export function withholdObjectKeys<T>(value: T): Promise<T> {
  return walk(value, async (text) => (isObjectKey(text) ? refFor(text) : text)) as Promise<T>;
}

/** Every object key in `value`, for resolving handles against a stored record. */
export function collectObjectKeys(value: Json): string[] {
  const found = new Set<string>();
  const visit = (node: Json): void => {
    if (typeof node === "string") {
      if (isObjectKey(node)) found.add(node);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...found];
}

export class UnknownHandleError extends Error {
  constructor(public readonly handle: string) {
    super(`Unknown file handle: ${handle}`);
    this.name = "UnknownHandleError";
  }
}

/**
 * A copy of `value` with every handle replaced by the key it stands for.
 * `storedKeys` are the keys of the record being saved. Throws UnknownHandleError
 * for anything that does not resolve, and a raw object key in the input is
 * treated the same way: this boundary hands them out to nobody, so one arriving
 * here is a guess at someone's file.
 */
export async function restoreObjectKeys<T>(
  value: T,
  storedKeys: readonly string[],
  grantId: string,
): Promise<T> {
  const byRef = new Map(
    await Promise.all(storedKeys.map(async (key) => [await refFor(key), key] as const)),
  );
  const admin = createAdminClient();
  return walk(value, async (text) => {
    if (isObjectKey(text)) throw new UnknownHandleError(text);
    if (text.startsWith(REF_PREFIX)) {
      const key = byRef.get(text);
      if (!key) throw new UnknownHandleError(text);
      return key;
    }
    if (text.startsWith(UPLOAD_PREFIX)) {
      const id = text.slice(UPLOAD_PREFIX.length);
      if (!UPLOAD_ID_PATTERN.test(id)) throw new UnknownHandleError(text);
      const { data, error } = await admin
        .from("agent_uploads")
        .select("object_key, expires_at")
        .eq("id", id)
        .eq("grant_id", grantId)
        .maybeSingle();
      if (error) throw new Error(`Reading an upload failed: ${error.message}`);
      if (!data || Date.parse(data.expires_at) <= Date.now()) throw new UnknownHandleError(text);
      return data.object_key;
    }
    return text;
  }) as Promise<T>;
}

/** Remember an uploaded file and return the handle the assistant may use. */
export async function rememberUpload(input: {
  grantId: string;
  kind: string;
  objectKey: string;
}): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("agent_uploads")
    .insert({
      grant_id: input.grantId,
      kind: input.kind,
      object_key: input.objectKey,
      expires_at: new Date(Date.now() + AGENT_UPLOAD_SECONDS * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("[agent] recording an upload failed:", error.message);
    return null;
  }
  return `${UPLOAD_PREFIX}${data.id}`;
}
