// WHICH STORED FILES NOTHING USES, as pure rules (the runner is
// scripts/sweep-unused-uploads.ts). An upload that was never attached to a
// product or storefront, or whose row is gone, stays in the bucket forever:
// unreachable, but still somebody's file. The account deletion review counted
// it as a gap (Teamster KmPKYYRMnZ42P43SDFmd, point 5).
//
// CONSERVATIVE BY DESIGN. Only a key in the app's own upload shape is ever a
// candidate; a key is "used" if it appears ANYWHERE in the database, in any
// column of any table, JSON included; and a file younger than the minimum age
// is left alone, because a seller may be between uploading it and saving.

/** MIRROR of objectKeyPrefix() over UPLOAD_KINDS (src/lib/validation/product.ts);
 *  tests/unit/unused-uploads.test.ts fails if they drift. */
export const UPLOAD_PREFIXES = ["images", "files", "fonts", "elements", "documents"] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** An upload key, unanchored: what the database scan searches every row for.
 *  No capturing group, so Postgres's regexp_matches returns the whole key. */
export const UPLOAD_KEY_IN_TEXT = `(?:${UPLOAD_PREFIXES.join("|")})/${UUID}/${UUID}-[A-Za-z0-9._-]{1,120}`;

const UPLOAD_KEY = new RegExp(`^${UPLOAD_KEY_IN_TEXT}$`);

export function isUploadKey(key: string): boolean {
  return UPLOAD_KEY.test(key);
}

/** Files under this age are never candidates. */
export const DEFAULT_MIN_AGE_DAYS = 7;

export type StoredObject = { key: string; size: number; lastModified: string };

export type SweepPlan = {
  /** Upload-shaped, older than the minimum age, referenced nowhere. */
  unused: StoredObject[];
  /** Unused but too new to touch yet. */
  tooNew: StoredObject[];
  /** Not in the upload shape at all (left alone whatever it is). */
  other: StoredObject[];
  usedCount: number;
};

export function planSweep(
  stored: StoredObject[],
  referenced: ReadonlySet<string>,
  now: Date,
  minAgeDays = DEFAULT_MIN_AGE_DAYS,
): SweepPlan {
  const cutoff = now.getTime() - minAgeDays * 24 * 60 * 60 * 1000;
  const plan: SweepPlan = { unused: [], tooNew: [], other: [], usedCount: 0 };
  for (const object of stored) {
    if (!isUploadKey(object.key)) plan.other.push(object);
    else if (referenced.has(object.key)) plan.usedCount += 1;
    else if (Date.parse(object.lastModified) > cutoff) plan.tooNew.push(object);
    else plan.unused.push(object);
  }
  return plan;
}

/** The keys in an S3 ListObjectsV2 XML page, and the token for the next page. */
export function parseListPage(xml: string): { objects: StoredObject[]; next: string | null } {
  const objects: StoredObject[] = [];
  for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
    const field = (name: string) => block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
    objects.push({
      key: field("Key").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      size: Number(field("Size")),
      lastModified: field("LastModified"),
    });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = truncated ? (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? null) : null;
  return { objects, next };
}
