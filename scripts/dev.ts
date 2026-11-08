// Run `next dev`, and restart it before it can take the machine down with it.
//
//   node scripts/dev.ts [next dev options]     (what `pnpm dev` runs)
//
// WHY THIS EXISTS. A `next dev` left running keeps growing. On 2026-11-05 the
// developer's own server had committed 17 GB after 26 hours (under half a GB
// of it in RAM, the rest pushed out to the pagefile), on a machine several
// sessions share, and its .next/dev had passed trim-next-cache's limit since
// it started. next.config.ts gives Turbopack a memory target
// (turbopackMemoryLimit), past which it drops cached work by itself; this is
// the hard stop behind that.
//
// Once a minute the server's whole process tree is measured. Over
// MAX_DEV_SERVER_BYTES on two checks running (one spike during a big compile
// is not a reason), or with its dev dir over trim-next-cache's limit, the
// server is stopped, the dir trimmed, and the server started again with the
// same options. Open pages reconnect by themselves; each route compiles once
// more, quickly unless the disk cache was what got trimmed.
//
// Override the limit for one run with DEV_SERVER_MAX_GB=12 pnpm dev.

import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { DIST_DIRS, MAX_DEV_DIR_BYTES, devDirBytes, trimNextCache } from "./trim-next-cache.ts";

/** Past this, summed over the server's process tree, it is restarted. */
const MAX_DEV_SERVER_BYTES = Number(process.env.DEV_SERVER_MAX_GB || 8) * 1024 ** 3;

/** How often the server is measured. */
const CHECK_EVERY_MS = 60_000;

/** Checks in a row over the limit before a restart. */
const STRIKES_TO_RESTART = 2;

/** The dev dir is measured on every this-many checks (it means walking it). */
const DISK_CHECK_EVERY = 10;

/** Pause between the old server's exit and the new one, so the port is free. */
const RESTART_PAUSE_MS = 1_000;

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** One row of the system's process table. */
export type ProcessRow = { pid: number; ppid: number; bytes: number };

/** Bytes held by `root` and everything it started, however deep. */
export function treeBytes(rows: readonly ProcessRow[], root: number): number {
  const inTree = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!inTree.has(row.pid) && inTree.has(row.ppid)) {
        inTree.add(row.pid);
        grew = true;
      }
    }
  }
  return rows.reduce((sum, row) => (inTree.has(row.pid) ? sum + row.bytes : sum), 0);
}

/** "pid ppid bytes" lines, as both readers below print them. */
export function parseProcessRows(table: string, bytesPerUnit = 1): ProcessRow[] {
  return table.split(/\r?\n/).flatMap((line) => {
    const [pid, ppid, amount] = line.trim().split(/\s+/).map(Number);
    return Number.isFinite(pid) && Number.isFinite(ppid) && Number.isFinite(amount)
      ? [{ pid, ppid, bytes: amount * bytesPerUnit }]
      : [];
  });
}

const run = promisify(execFile);

/**
 * The process table. On Windows each process's private bytes: what fills RAM
 * and the pagefile, where a server that has been paged out still counts. On
 * macOS and Linux the resident size, which `ps` gives in KB.
 */
async function processRows(): Promise<ProcessRow[] | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,PrivatePageCount | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.PrivatePageCount)" }',
        ],
        { windowsHide: true, maxBuffer: 4 * 1024 ** 2 },
      );
      return parseProcessRows(stdout);
    }
    const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,rss="], { maxBuffer: 4 * 1024 ** 2 });
    return parseProcessRows(stdout, 1024);
  } catch {
    // A failed reading is no reading: never restart on a guess.
    return null;
  }
}

/** Stop the server and everything it started (Turbopack's workers too). */
function stopTree(child: ChildProcess, wait = false): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const args = ["/PID", String(child.pid), "/T", "/F"];
    if (wait) spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true });
    else spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM"); // its own process group, see start()
  } catch {
    child.kill("SIGTERM");
  }
}

function main(): void {
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const distDir = process.env.NEXT_DIST_DIR || ".next";
  const options = process.argv.slice(2);

  let child: ChildProcess;
  let restarting = false;
  let strikes = 0;
  let checks = 0;

  const start = (): void => {
    child = spawn(process.execPath, [nextBin, "dev", ...options], {
      stdio: "inherit",
      // A group of its own, so a restart can stop Turbopack's workers with it.
      // Not on Windows, where it would open a second console window.
      detached: process.platform !== "win32",
    });
    child.on("exit", (code, signal) => {
      if (!restarting) process.exit(code ?? (signal ? 1 : 0));
      restarting = false;
      trimNextCache(distDir);
      setTimeout(start, RESTART_PAUSE_MS);
    });
  };

  const restart = (why: string): void => {
    console.log(`[dev] ${why}: restarting next dev.`);
    restarting = true;
    strikes = 0;
    stopTree(child);
  };

  const check = async (): Promise<void> => {
    if (restarting || child.pid === undefined) return;
    checks += 1;
    const rows = await processRows();
    const bytes = rows ? treeBytes(rows, child.pid) : 0;
    strikes = bytes > MAX_DEV_SERVER_BYTES ? strikes + 1 : 0;
    if (strikes >= STRIKES_TO_RESTART) {
      restart(`it is using ${gb(bytes)}, over the ${gb(MAX_DEV_SERVER_BYTES)} limit`);
      return;
    }
    if (checks % DISK_CHECK_EVERY === 0) {
      const disk = devDirBytes(distDir);
      if (disk > MAX_DEV_DIR_BYTES) restart(`${distDir}/dev has grown to ${gb(disk)}`);
    }
  };

  for (const dir of DIST_DIRS) trimNextCache(dir);
  start();
  setInterval(() => void check(), CHECK_EVERY_MS);

  // Ctrl+C reaches the server too; this makes sure nothing it started outlives
  // the terminal, which is how orphaned dev servers fill the machine.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      restarting = false;
      stopTree(child);
    });
  }
  process.on("exit", () => stopTree(child, true));
}

// Run as a script, not when imported (see trim-next-cache.ts).
if ((import.meta as ImportMeta & { main?: boolean }).main) main();
