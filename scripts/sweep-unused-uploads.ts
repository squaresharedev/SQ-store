// UNUSED UPLOADS: list the files in the uploads bucket that nothing in the
// database refers to (rules in ./lib/unused-uploads.ts).
//
//   node --env-file-if-exists=.env.local scripts/sweep-unused-uploads.ts
//       DRY RUN (the default): prints what is unused and changes nothing.
//   ... scripts/sweep-unused-uploads.ts --delete
//       deletes exactly the files a dry run lists. Cannot be undone: run the
//       dry run first and read the list.
//
// Needs R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// and SUPABASE_ACCESS_TOKEN + NEXT_PUBLIC_SUPABASE_URL (the Management API,
// read-only queries) for the database scan.
import { AwsClient } from "aws4fetch";
import {
  DEFAULT_MIN_AGE_DAYS,
  UPLOAD_KEY_IN_TEXT,
  parseListPage,
  planSweep,
  type StoredObject,
} from "./lib/unused-uploads.ts";

const DELETE = process.argv.includes("--delete");

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const bucket = need("R2_BUCKET_NAME");
const endpoint = `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${bucket}`;
const r2 = new AwsClient({
  accessKeyId: need("R2_ACCESS_KEY_ID"),
  secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
  service: "s3",
  region: "auto",
});

async function listBucket(): Promise<StoredObject[]> {
  const all: StoredObject[] = [];
  let token: string | null = null;
  do {
    const url = new URL(endpoint);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);
    const res = await r2.fetch(url.toString());
    if (!res.ok) throw new Error(`listing the bucket failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = parseListPage(await res.text());
    all.push(...page.objects);
    token = page.next;
  } while (token);
  return all;
}

async function query<T>(sql: string): Promise<T[]> {
  const ref = new URL(need("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${need("SUPABASE_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!res.ok) throw new Error(`database query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T[];
}

/** Every upload key mentioned anywhere in the public schema, any column, JSON included. */
async function referencedKeys(): Promise<Set<string>> {
  const tables = await query<{ name: string }>(
    "select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
  );
  const pattern = UPLOAD_KEY_IN_TEXT.replace(/'/g, "''");
  const union = tables
    .map(({ name }) => `select (regexp_matches(t::text, '${pattern}', 'g'))[1] as key from public."${name.replace(/"/g, '""')}" t`)
    .join(" union ");
  const rows = await query<{ key: string }>(union);
  return new Set(rows.map((r) => r.key));
}

const now = new Date();
const [stored, referenced] = await Promise.all([listBucket(), referencedKeys()]);
const plan = planSweep(stored, referenced, now);
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const total = (objects: StoredObject[]) => objects.reduce((sum, o) => sum + o.size, 0);

console.log(`Bucket ${bucket}: ${stored.length} files, ${mb(total(stored))}.`);
console.log(`  in use:                ${plan.usedCount}`);
console.log(`  unused, younger than ${DEFAULT_MIN_AGE_DAYS} days (left alone): ${plan.tooNew.length}`);
console.log(`  not an upload key (left alone): ${plan.other.length}${plan.other.length ? ` (${[...new Set(plan.other.map((o) => o.key.split("/")[0]))].join(", ")})` : ""}`);
console.log(`  UNUSED:                ${plan.unused.length}, ${mb(total(plan.unused))}`);
for (const o of plan.unused) console.log(`    ${o.lastModified.slice(0, 10)}  ${String(o.size).padStart(9)}  ${o.key}`);

if (!DELETE) {
  console.log(plan.unused.length ? "\nDry run: nothing was deleted. Re-run with --delete to remove the files listed above." : "\nNothing to remove.");
} else {
  let removed = 0;
  for (const o of plan.unused) {
    const res = await r2.fetch(`${endpoint}/${o.key.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
    if (res.ok || res.status === 404) removed += 1;
    else console.error(`  could not delete ${o.key}: ${res.status}`);
  }
  console.log(`\nDeleted ${removed} of ${plan.unused.length}.`);
}
