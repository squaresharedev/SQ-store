// Clear a Next.js dev build dir once it has grown too big.
//
//   node scripts/trim-next-cache.ts [distDir ...]     (default: .next .next-e2e)
//
// Runs on its own before `pnpm dev` and before the E2E stack's `next dev`
// (tests/e2e/stack/server.mjs), so nobody has to remember it.
//
// WHY THIS EXISTS. Nothing prunes Turbopack's persistent dev cache
// (<distDir>/dev/cache) or the compiled chunks next to it. Two days of normal
// work grew .next/dev to 11 GB (a thousand ~250 MB cache files) and
// .next-e2e/dev to 2.8 GB, and a `next dev` started on that cache settled about
// 1.5 GB higher than one started clean. With the developer's own dev server,
// E2E stacks and agent sessions all running at once, the machine ran out of
// RAM and went down. Deleting the dir is always safe: Next rebuilds it, and
// the only cost is a slower first compile of each route.
//
// A dir whose `next dev` is still running (its lockfile names a live pid) is
// left alone: deleting files out from under Turbopack corrupts its cache.

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Above this, <distDir>/dev is deleted before the next dev server starts. */
const MAX_DEV_DIR_BYTES = 3 * 1024 ** 3;

/** Every build dir `next dev` writes to (see distDir in next.config.ts). */
const DIST_DIRS = [".next", ".next-e2e"];

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function dirBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
  }
  return total;
}

/**
 * True while a `next dev` holds this dir. Next writes `{ pid, ... }` into
 * <distDir>/dev/lock; a lock left behind by a crashed server names a dead pid.
 * Anything unreadable counts as in use, which errs on the side of not deleting.
 */
function inUse(devDir: string): boolean {
  const lock = join(devDir, "lock");
  if (!existsSync(lock)) return false;
  let pid: unknown;
  try {
    pid = JSON.parse(readFileSync(lock, "utf8")).pid;
  } catch {
    return true;
  }
  if (typeof pid !== "number") return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Delete <distDir>/dev when it is over the cap and no dev server owns it. */
export function trimNextCache(distDir: string): void {
  const devDir = join(REPO, distDir, "dev");
  try {
    if (!existsSync(devDir)) return;
    const bytes = dirBytes(devDir);
    if (bytes <= MAX_DEV_DIR_BYTES) return;
    if (inUse(devDir)) {
      console.warn(`[trim-next-cache] ${distDir}/dev is ${gb(bytes)} but a dev server is using it; left alone.`);
      return;
    }
    rmSync(devDir, { recursive: true, force: true, maxRetries: 3 });
    console.log(`[trim-next-cache] cleared ${distDir}/dev (${gb(bytes)}); the first compile of each route will be slower.`);
  } catch (err) {
    // Never block a dev server from starting over housekeeping.
    console.warn(`[trim-next-cache] could not trim ${distDir}/dev: ${(err as Error).message}`);
  }
}

// Run as a script, not when imported. `import.meta.main` is Node 24's own
// check; the installed @types/node predates it.
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const dirs = process.argv.slice(2);
  for (const dir of dirs.length > 0 ? dirs : DIST_DIRS) trimNextCache(dir);
}
