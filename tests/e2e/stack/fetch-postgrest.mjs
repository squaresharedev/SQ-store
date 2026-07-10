/**
 * Downloads the PostgREST binary into tools/postgrest/ (gitignored).
 * Run once per machine before `pnpm test:e2e`: node tests/e2e/stack/fetch-postgrest.mjs
 */
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const VERSION = "v14.14";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(REPO, "tools", "postgrest");
const EXE = join(DIR, process.platform === "win32" ? "postgrest.exe" : "postgrest");

if (existsSync(EXE)) {
  console.log(`postgrest already present at ${EXE}`);
  process.exit(0);
}

const asset =
  process.platform === "win32"
    ? `postgrest-${VERSION}-windows-x86-64.zip`
    : process.platform === "darwin"
      ? `postgrest-${VERSION}-macos-x86-64.tar.xz`
      : `postgrest-${VERSION}-linux-static-x86-64.tar.xz`;

const url = `https://github.com/PostgREST/postgrest/releases/download/${VERSION}/${asset}`;
console.log(`downloading ${url} ...`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
mkdirSync(DIR, { recursive: true });
const archive = join(DIR, asset);
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

if (asset.endsWith(".zip")) {
  execFileSync("tar", ["-xf", archive, "-C", DIR]);
} else {
  execFileSync("tar", ["-xJf", archive, "-C", DIR]);
}
rmSync(archive);
console.log(`postgrest ready at ${EXE}`);
