// @vitest-environment node
import { describe, it } from "vitest";
import { DOCUMENT_CASES, MEDIA_CASES, type DocumentCase, type MediaCase } from "../moderation/media";
import { textPdf } from "../moderation/pdf";
import { assertScore, describeScore, score, scoreTable, type Answered } from "../moderation/score";

/**
 * THE REAL MEDIA CHECK, AGAINST LABELLED PHOTOS AND DOCUMENTS. Opt-in, like
 * the text eval (auto-moderation.live.test.ts), and scored the same way
 * (tests/moderation/score.ts):
 *
 *   MODERATION_LIVE_TEST=1 ANTHROPIC_API_KEY=... npx vitest run --project unit \
 *     tests/unit/auto-moderation-media.live.test.ts
 *
 * The photos (tests/moderation/media.ts) are fetched from Wikimedia Commons
 * when it runs and the PDFs are built from text, and both are handed to the
 * classifier as bytes through classifyMediaBytes: the same question, limits
 * and answer handling as the deployed check, which passes a signed storage URL
 * instead. A photo that cannot be fetched fails the run, like a missing answer.
 */
const LIVE = process.env.MODERATION_LIVE_TEST === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

/** Commons asks every client to name itself. */
const USER_AGENT = "SquareShareModerationEval/1.0 (https://squareshare.eu)";

/** About the size a product photo is shown at. */
const THUMB_WIDTH = 640;

const CONCURRENCY = 4;

async function inBatches<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let at = 0; at < items.length; at += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(at, at + CONCURRENCY).map(run))));
  }
  return results;
}

async function report(label: string, answers: Answered[]): Promise<void> {
  const { MODERATION_MODEL } = await import("@/lib/moderation/auto/policy");
  const result = score(answers);
  console.log(`${label}\n${describeScore(MODERATION_MODEL, answers.length, result)}`);
  // Every verdict, for a human to read: MODERATION_TABLE_FILE=<path>, one file per kind.
  if (process.env.MODERATION_TABLE_FILE) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      process.env.MODERATION_TABLE_FILE.replace(/(\.json)?$/, `-${label}.json`),
      JSON.stringify(scoreTable(answers), null, 1),
    );
  }
  assertScore(result);
}

/** The thumbnail URL of every file, from the Commons API (50 titles a request). */
async function thumbnails(files: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (let at = 0; at < files.length; at += 50) {
    const api = new URL("https://commons.wikimedia.org/w/api.php");
    api.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      titles: files.slice(at, at + 50).join("|"),
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: String(THUMB_WIDTH),
    }).toString();
    const response = await fetch(api, { headers: { "User-Agent": USER_AGENT } });
    const data = (await response.json()) as {
      query?: {
        normalized?: { from: string; to: string }[];
        pages?: { title: string; imageinfo?: { thumburl?: string }[] }[];
      };
    };
    const fromTitle = new Map((data.query?.normalized ?? []).map(({ from, to }) => [to, from]));
    for (const page of data.query?.pages ?? []) {
      const url = page.imageinfo?.[0]?.thumburl;
      if (url) urls.set(fromTitle.get(page.title) ?? page.title, url);
    }
  }
  return urls;
}

async function photo(url: string): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" }> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  return { data: bytes.toString("base64"), mediaType: png ? "image/png" : "image/jpeg" };
}

describe.skipIf(!LIVE)("the media check on labelled files (live)", () => {
  it(
    "photos: leaks nothing, holds no ordinary photo, and gives the right reason",
    async () => {
      const { classifyMediaBytes } = await import("@/lib/moderation/auto/classify");
      const urls = await thumbnails(MEDIA_CASES.map(({ file }) => file));
      const missing = MEDIA_CASES.filter(({ file }) => !urls.has(file)).map(({ file }) => file);
      if (missing.length > 0) throw new Error(`not on Commons any more: ${missing.join(", ")}`);

      const answers = await inBatches(MEDIA_CASES, async (item: MediaCase) => ({
        item,
        answer: await classifyMediaBytes({ kind: "image", ...(await photo(urls.get(item.file)!)) }),
      }));
      await report("photos", answers);
    },
    600_000,
  );

  it(
    "documents: leaks nothing, holds no ordinary document, and gives the right reason",
    async () => {
      const { classifyMediaBytes } = await import("@/lib/moderation/auto/classify");
      const answers = await inBatches(DOCUMENT_CASES, async (item: DocumentCase) => ({
        item,
        answer: await classifyMediaBytes({ kind: "pdf", data: textPdf(item.pages).toString("base64") }),
      }));
      await report("documents", answers);
    },
    300_000,
  );
});
