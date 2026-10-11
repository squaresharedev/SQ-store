// SERVER ONLY, DEVELOPMENT ONLY. The stand-in classifier.
//
// The e2e stack and a laptop without a key still need the whole flow to run:
// a save, the wall, the check, the outcome. This answers in place of the real
// classifier, deterministically, from markers a test puts in the content.
// classify.ts reaches it only behind moderationTestProvider(), which is false
// in every production build.
//
//   text containing   [[violation]] or [[violation:<ground>]]  -> violation
//                     [[unsure]]                                 -> unsure
//   a stored file whose name contains "violation" or "unsure"   -> the same
//   a handle containing "violation" or "unsure"                 -> the same
//                     (a handle is a-z, 0-9 and _: it cannot carry brackets)
//   anything else                                                -> clean

import { isRemovalGround } from "@/lib/moderation/removal";
import { linePath, type PartVerdict } from "@/lib/moderation/auto/policy";

const VIOLATION_MARKER = /\[\[violation(?::([a-z]+))?\]\]/;
const UNSURE_MARKER = "[[unsure]]";

/** The one line checkHandle sends. */
const HANDLE_LINE = /^username=/;
const marked = (line: string, marker: RegExp | string, word: string) =>
  (typeof marker === "string" ? line.includes(marker) : marker.test(line)) ||
  (HANDLE_LINE.test(line) && line.includes(word));

export function classifyTextForTest(lines: readonly string[]): PartVerdict {
  const flagged = lines.filter((line) => marked(line, VIOLATION_MARKER, "violation"));
  if (flagged.length > 0) {
    const named = VIOLATION_MARKER.exec(flagged[0])?.[1];
    return {
      verdict: "violation",
      ground: isRemovalGround(named) ? named : "other",
      paths: [...new Set(flagged.map(linePath))],
    };
  }
  const doubtful = lines.filter((line) => marked(line, UNSURE_MARKER, "unsure"));
  if (doubtful.length > 0) {
    return { verdict: "unsure", ground: null, paths: [...new Set(doubtful.map(linePath))] };
  }
  return { verdict: "clean", ground: null, paths: [] };
}

export function classifyMediaForTest(key: string): PartVerdict {
  const name = key.slice(key.lastIndexOf("/") + 1).toLowerCase();
  if (name.includes("violation")) return { verdict: "violation", ground: "sexual", paths: [] };
  if (name.includes("unsure")) return { verdict: "unsure", ground: null, paths: [] };
  return { verdict: "clean", ground: null, paths: [] };
}
