import { AwsClient } from "aws4fetch";
import type { UploadKind } from "@/lib/validation/product";

/**
 * SERVER-ONLY. Presigned-URL helpers for the private `squareshare-products` R2
 * bucket, via R2's S3-compatible API. aws4fetch (not the AWS SDK) keeps the
 * worker bundle small — we are near the OpenNext size limit.
 *
 * R2 credentials come from env (see .env.example) and must NEVER be exposed
 * with a NEXT_PUBLIC_ prefix or imported from client components.
 */

/** Short-lived: the client PUTs immediately after asking. */
const PRESIGN_EXPIRY_SECONDS = 300;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Reduce a user-supplied filename to a safe object-key segment: basename only
 * (no path traversal), conservative charset, bounded length. Never interpolate
 * a raw filename into a key.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 120);
  return cleaned || "file";
}

/** `images/{ownerId}/{uuid}-{name}` or `files/{ownerId}/{uuid}-{name}`. */
export function buildObjectKey(
  kind: UploadKind,
  ownerId: string,
  filename: string,
): string {
  const prefix = kind === "image" ? "images" : "files";
  return `${prefix}/${ownerId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
}

/**
 * Presigned PUT URL for a direct browser upload.
 *
 * SECURITY: a presigned PUT (query-auth) signs only `host` — S3/SigV4 treats
 * Content-Type and Content-Length as unsignable, and R2 supports neither a POST
 * policy (no PostObject) nor a signed Content-Length. So the kind/type/size
 * checks at presign time are an early-reject UX convenience ONLY; a crafted
 * client can PUT any type or size to its own key. The real enforcement is
 * server-side: {@link headObject} re-checks the stored object's true size and
 * type at save time (see verifyOwnedObject in lib/products/actions.ts), and
 * oversized/wrong objects are deleted and never linked to a product.
 */
/** True once the human has pasted the R2 credentials into env. */
export function hasR2Credentials(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

function objectUrl(key: string): URL {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET_NAME");
  // Keys are minted by buildObjectKey from a conservative charset, so the raw
  // key is already URL-safe.
  return new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`,
  );
}

// One client per isolate. aws4fetch memoizes derived signing keys on the
// instance keyed by date, so reusing it (rather than reallocating per request)
// lets stable-dated GET signatures skip HMAC key derivation on repeat calls.
let cachedClient: AwsClient | undefined;
function r2Client(): AwsClient {
  if (!cachedClient) {
    cachedClient = new AwsClient({
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
      // Bounded retries for server-side HEAD/DELETE (the default is 10, which
      // would stall a save on a flaky R2). Only 5xx/429 are retried.
      retries: 3,
    });
  }
  return cachedClient;
}

/** aws4fetch's X-Amz-Date basic format, e.g. `20260703T090000Z`. */
function amzDatetime(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export async function presignPutUrl(
  key: string,
  contentType: string,
): Promise<string> {
  const url = objectUrl(key);
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRY_SECONDS));
  const signed = await r2Client().sign(
    new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

/** Real size (bytes) and stored Content-Type of an object, or null if absent. */
export type ObjectMeta = { size: number; contentType: string | null };

/**
 * SERVER-SIDE HeadObject — the size/type security boundary. Reads the object's
 * true, stored metadata (not the client's claim at presign time). Returns null
 * for a missing object (404); throws on other transport/credential failures so
 * the caller fails closed rather than trusting an unverified upload.
 */
export async function headObject(key: string): Promise<ObjectMeta | null> {
  const res = await r2Client().fetch(objectUrl(key).toString(), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${key} failed: ${res.status}`);
  const length = res.headers.get("content-length");
  return {
    size: length === null ? Number.NaN : Number(length),
    contentType: res.headers.get("content-type"),
  };
}

/**
 * SERVER-SIDE DeleteObject. Idempotent: a 404/204 both mean "gone". Used to
 * evict objects that fail post-upload verification so abusive/oversized uploads
 * are not retained.
 */
export async function deleteObject(key: string): Promise<void> {
  const res = await r2Client().fetch(objectUrl(key).toString(), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 DELETE ${key} failed: ${res.status}`);
  }
}

// Dashboard preview GETs are anchored to the top of the clock hour and given a
// 2-hour window. Anchoring makes the signed URL byte-identical for every render
// within the same hour, so the browser can cache the image instead of
// re-fetching it from R2 on each page load; the 2h window keeps it valid for at
// least an hour past any anchor.
const GET_ANCHOR_MS = 60 * 60 * 1000;
const GET_EXPIRY_SECONDS = 2 * 60 * 60;

/**
 * Signed GET URL for rendering a stored object in the DASHBOARD (seller's own
 * assets: product images in the products list / storefront designer preview).
 * Returns null instead of throwing when R2 credentials are not configured yet,
 * so pages degrade to placeholder tiles rather than erroring.
 *
 * TODO(delivery stage): buyer-side post-purchase downloads are a separate,
 * stricter path (purchase check + short expiry) — do not reuse this for them.
 */
export async function presignGetUrl(key: string): Promise<string | null> {
  if (!hasR2Credentials()) return null;
  try {
    const url = objectUrl(key);
    url.searchParams.set("X-Amz-Expires", String(GET_EXPIRY_SECONDS));
    const anchorMs = Math.floor(Date.now() / GET_ANCHOR_MS) * GET_ANCHOR_MS;
    const signed = await r2Client().sign(new Request(url, { method: "GET" }), {
      aws: { signQuery: true, datetime: amzDatetime(anchorMs) },
    });
    return signed.url;
  } catch (error) {
    console.error("[r2] presign GET failed", error);
    return null;
  }
}
