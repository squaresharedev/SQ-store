// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseProcessRows, treeBytes, type ProcessRow } from "../../scripts/dev.ts";

/**
 * scripts/dev.ts restarts `next dev` when its process tree holds too much.
 * The tree is the point: the server itself is small, and Turbopack's workers
 * and the start-server child it spawns are where the memory sits.
 */

const GB = 1024 ** 3;

describe("treeBytes", () => {
  const rows: ProcessRow[] = [
    { pid: 10, ppid: 1, bytes: 0.1 * GB }, // next dev, the CLI
    { pid: 11, ppid: 10, bytes: 15 * GB }, // start-server.js
    { pid: 12, ppid: 11, bytes: 0.1 * GB }, // a Turbopack loader worker
    { pid: 13, ppid: 12, bytes: 0.1 * GB }, // and one under it
    { pid: 20, ppid: 1, bytes: 9 * GB }, // somebody else's process
    { pid: 21, ppid: 20, bytes: 1 * GB },
  ];

  it("counts the server and everything under it, however deep", () => {
    expect(treeBytes(rows, 10)).toBeCloseTo(15.3 * GB);
  });

  it("counts nothing outside the tree", () => {
    expect(treeBytes(rows, 11)).toBeCloseTo(15.2 * GB);
    expect(treeBytes(rows, 99)).toBe(0);
  });
});

describe("parseProcessRows", () => {
  it("reads Windows' private bytes as they come", () => {
    expect(parseProcessRows("10 1 17076707328\r\n11 10 2048\r\n")).toEqual([
      { pid: 10, ppid: 1, bytes: 17076707328 },
      { pid: 11, ppid: 10, bytes: 2048 },
    ]);
  });

  it("reads ps's resident size in KB, and skips lines that are not rows", () => {
    expect(parseProcessRows("  10     1  2048\nheader line\n\n", 1024)).toEqual([{ pid: 10, ppid: 1, bytes: 2048 * 1024 }]);
  });
});
