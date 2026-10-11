// SERVER ONLY. The automatic check: what turns a pending row into a decision.
//
// THE WALL IS IN THE DATABASE (20261012_auto_moderation.sql). A row is public
// only while every part of its content is on the approved list, and that is
// enforced by a trigger no app can skip. This module's whole job is to grow
// that list: it asks the classifier about parts nobody has judged yet,
// records the answers, and asks the database to settle the row. It never sets
// a status itself and cannot make anything public: moderation_settle answers
// from the approved list and nothing else.
//
// THREE ENTRY POINTS, one mechanism:
//
//   precheck     before a save: the content about to be written is judged
//                first, so a clean edit to a live listing passes the wall
//                inline and is never hidden.
//   checkTarget  after a save, and for everything the sweep finds: one row,
//                read from the database (the caller never says what the
//                content is), judged and settled.
//   sweep        the worklist: rows written around the app, rows whose check
//                failed or timed out, and the audit of content from before
//                the wall.
//
// NOTHING HERE THROWS. A check that cannot run leaves the row pending, which
// is hidden, which is the safe state; the save that triggered it has already
// succeeded and must not be failed by a classifier outage.

import { after } from "next/server";
import { z } from "zod";
import { createNotification } from "@/lib/notifications/create";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignGetUrl } from "@/lib/r2";
import { pingAdminModeration } from "@/lib/moderation/admin-ping";
import { fixFieldForPath, fixFieldsFor, type FixTarget } from "@/lib/moderation/fix-fields";
import { REMOVAL_GROUNDS, type RemovalGround } from "@/lib/moderation/removal";
import { productEditPath } from "@/lib/products/paths";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import {
  classifyMedia,
  classifyText,
  type ClassifyResult,
} from "@/lib/moderation/auto/classify";
import {
  MEDIA_PARTS_PER_RUN,
  MODERATION_MODEL,
  type ModerationScope,
  type PartVerdict,
  type Verdict,
} from "@/lib/moderation/auto/policy";
import type { Json } from "@/types";

/** What can be checked: the three tables the wall is attached to. Mirror of
 *  moderation_table() in the migration. */
export const AUTO_TARGETS = ["product", "storefront", "artifact"] as const;
export type AutoTarget = (typeof AUTO_TARGETS)[number];

export function isAutoTarget(value: unknown): value is AutoTarget {
  return typeof value === "string" && (AUTO_TARGETS as readonly string[]).includes(value);
}

/**
 * Where a row stands once a check has run.
 *
 *   ok       public
 *   pending  not judged yet (no answer was obtained); the sweep will try again
 *   review   held for a person
 *   paused   refused automatically; the seller can fix it and it is re-checked
 *   removed  refused automatically, with no way to fix it (an artifact)
 *   gone     the row no longer exists
 *
 * A row a person has already ruled on comes back as that ruling's status.
 */
export type AutoOutcome = "ok" | "pending" | "review" | "paused" | "removed" | "gone";

const mediaPartSchema = z.object({
  kind: z.enum(["image", "pdf"]),
  key: z.string(),
  subject: z.string(),
  path: z.string(),
});

const partsSchema = z.object({
  lines: z.array(z.string()),
  text_subject: z.string().nullable(),
  media: z.array(mediaPartSchema),
});

const claimSchema = partsSchema.extend({
  rev: z.number().int(),
  status: z.string(),
  checked: z.boolean(),
  owner_id: z.string(),
  title: z.string(),
});

const settledSchema = z.object({
  outcome: z.string(),
  status: z.string().optional(),
  ground: z.string().optional(),
  fields: z.array(z.string()).optional(),
  decision_id: z.string().optional(),
  owner_id: z.string().optional(),
  title: z.string().optional(),
});

type Parts = z.infer<typeof partsSchema>;
type Judged = Map<string, PartVerdict>;

const storedVerdictSchema = z.object({
  subject: z.string(),
  verdict: z.enum(["clean", "unsure", "violation"]),
  ground: z.enum(REMOVAL_GROUNDS).nullable(),
  paths: z.array(z.string()),
});

function log(message: string, detail?: unknown) {
  console.error(`[moderation] ${message}`, detail instanceof Error ? detail.message : (detail ?? ""));
}

/**
 * Every part of a row with a verdict: the remembered ones, plus an answer from
 * the classifier for each part nobody has judged. A part the classifier could
 * not answer about right now is simply absent from the result.
 *
 * First answer wins (the insert ignores a subject that already has one), so
 * two checks racing on the same photo cannot disagree, and a person's
 * approval is never overwritten by the classifier.
 */
async function judgeParts(scope: ModerationScope, parts: Parts): Promise<Judged> {
  const subjects = [
    ...(parts.text_subject ? [parts.text_subject] : []),
    ...parts.media.map((part) => part.subject),
  ];
  const judged: Judged = new Map();
  if (subjects.length === 0) return judged;

  const admin = createAdminClient();
  const { data: known, error } = await admin
    .from("moderation_checks")
    .select("subject, verdict, ground, paths")
    .in("subject", subjects);
  if (error) throw new Error(`reading the approved list failed: ${error.message}`);
  for (const row of known ?? []) {
    const stored = storedVerdictSchema.safeParse(row);
    if (stored.success) {
      judged.set(stored.data.subject, {
        verdict: stored.data.verdict,
        ground: stored.data.ground,
        paths: stored.data.paths,
      });
    }
  }

  const asks: Promise<readonly [string, ClassifyResult]>[] = [];
  if (parts.text_subject && !judged.has(parts.text_subject)) {
    const subject = parts.text_subject;
    asks.push(classifyText(scope, parts.lines).then((verdict) => [subject, verdict] as const));
  }
  for (const part of parts.media.filter((item) => !judged.has(item.subject)).slice(0, MEDIA_PARTS_PER_RUN)) {
    asks.push(
      presignGetUrl(part.key)
        .then((url) => classifyMedia(part.kind, part.key, url))
        .then((verdict) => [part.subject, verdict] as const),
    );
  }
  if (asks.length === 0) return judged;

  const answers = (await Promise.all(asks)).filter(
    (answer): answer is readonly [string, PartVerdict] => answer[1] !== null,
  );
  if (answers.length === 0) return judged;

  const { error: writeError } = await admin.from("moderation_checks").upsert(
    answers.map(([subject, verdict]) => ({
      subject,
      verdict: verdict.verdict,
      ground: verdict.ground,
      paths: verdict.paths,
      source: "model",
      model: MODERATION_MODEL,
    })),
    { onConflict: "subject", ignoreDuplicates: true },
  );
  if (writeError) throw new Error(`recording verdicts failed: ${writeError.message}`);
  for (const [subject, verdict] of answers) judged.set(subject, verdict);
  return judged;
}

const GROUND_URGENCY: readonly RemovalGround[] = REMOVAL_GROUNDS;

/** What a violation is about, in the seller's terms: the most urgent ground
 *  among the failing parts, and the parts of the form they sit in. */
function describeViolation(
  type: AutoTarget,
  parts: Parts,
  judged: Judged,
): { ground: RemovalGround | null; fields: string[] } {
  const grounds: RemovalGround[] = [];
  const paths: string[] = [];
  const text = parts.text_subject ? judged.get(parts.text_subject) : undefined;
  if (text?.verdict === "violation") {
    if (text.ground) grounds.push(text.ground);
    paths.push(...text.paths);
  }
  for (const part of parts.media) {
    const verdict = judged.get(part.subject);
    if (verdict?.verdict !== "violation") continue;
    if (verdict.ground) grounds.push(verdict.ground);
    paths.push(part.path);
  }
  const ground = GROUND_URGENCY.find((candidate) => grounds.includes(candidate)) ?? null;
  if (type === "artifact") return { ground, fields: [] };
  const target: FixTarget = type;
  // Through fixFieldsFor so the list is in form order and holds nothing the
  // decision's CHECK would refuse.
  return {
    ground,
    fields: fixFieldsFor(target, paths.map((path) => fixFieldForPath(target, path))),
  };
}

/** The seller hears about an automated pause the same way they hear about a
 *  person's: a policy notification that opens the listing. */
async function tellSeller(
  type: FixTarget,
  id: string,
  settled: z.infer<typeof settledSchema>,
): Promise<void> {
  if (!settled.owner_id) return;
  await createNotification({
    userId: settled.owner_id,
    type: "policy",
    message: {
      title: {
        key: "Notifications.messages.policy.autoPaused.title",
        values: { target: type, title: (settled.title ?? "").slice(0, 60) },
      },
      body: { key: "Notifications.messages.policy.autoPaused.body", values: { target: type } },
    },
    data: {
      kind: "content_paused",
      automated: true,
      targetType: type,
      targetId: id,
      ...(settled.ground ? { ground: settled.ground } : {}),
      ...(settled.fields ? { fields: settled.fields } : {}),
      ...(settled.decision_id ? { decisionId: settled.decision_id } : {}),
      href: type === "product" ? productEditPath(id) : STOREFRONT_LIST_PATH,
    },
  });
}

/** Staff hear about a held row now rather than at their next scheduled scan.
 *  After the response where there is one; the ping never throws or blocks. */
function tellStaff(): void {
  try {
    after(pingAdminModeration);
  } catch {
    // Outside a request (a script, a test) there is no response to wait for.
    void pingAdminModeration();
  }
}

async function claim(type: AutoTarget, id: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("moderation_claim", { p_type: type, p_id: id });
  if (error) throw new Error(`claim failed: ${error.message}`);
  if (data === null) return null;
  return claimSchema.parse(data);
}

/** A row that is waiting on the check: pending, or live but never looked at. */
function isWaiting(row: { status: string; checked: boolean }): boolean {
  return row.status === "pending" || (row.status === "ok" && !row.checked);
}

function asOutcome(status: string): AutoOutcome {
  return status === "ok" || status === "review" || status === "paused" || status === "removed"
    ? status
    : "pending";
}

/**
 * Check one stored row and settle it. Safe to call on anything, any number of
 * times: a row that is not waiting is left exactly as it is.
 */
export async function checkTarget(type: AutoTarget, id: string): Promise<AutoOutcome> {
  try {
    const row = await claim(type, id);
    if (!row) return "gone";
    if (!isWaiting(row)) return asOutcome(row.status);

    const judged = await judgeParts(type, row);
    const violation = describeViolation(type, row, judged);

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("moderation_settle", {
      p_type: type,
      p_id: id,
      p_rev: row.rev,
      p_ground: violation.ground,
      p_fields: violation.fields.length > 0 ? violation.fields : null,
    });
    if (error) throw new Error(`settle failed: ${error.message}`);
    const settled = settledSchema.parse(data);

    switch (settled.outcome) {
      case "ok":
        return "ok";
      case "paused":
        if (type !== "artifact") await tellSeller(type, id, settled);
        return "paused";
      case "removed":
        return "removed";
      case "review":
        tellStaff();
        return "review";
      case "gone":
        return "gone";
      case "settled":
        return asOutcome(settled.status ?? "pending");
      default:
        // "unchecked": a part still has no answer. "stale": the seller saved
        // again while we were asking. Either way the row is still waiting, and
        // whoever saved last (or the sweep) settles it.
        return row.status === "ok" ? "ok" : "pending";
    }
  } catch (error) {
    log(`check of ${type} ${id} did not finish:`, error);
    return "pending";
  }
}

/**
 * Judge content BEFORE it is written: the stored row (none for a new one)
 * with the caller's column changes laid over it. When every part comes back
 * clean, the write that follows passes the wall inline and the row is never
 * hidden; otherwise the write lands pending and checkTarget settles it.
 *
 * `patch` is the object about to be handed to insert() or update(), so the
 * database works out the parts from the same values it is about to store.
 * Best-effort: on any failure the save simply takes the slower path.
 */
export async function precheck(
  type: AutoTarget,
  id: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("moderation_preview", {
      p_type: type,
      p_id: id,
      p_patch: patch as Json,
    });
    // The wall's migration is not applied here yet: nothing to warm.
    if (error?.code === "PGRST202") return;
    if (error) throw new Error(`preview failed: ${error.message}`);
    await judgeParts(type, partsSchema.parse(data));
  } catch (error) {
    log(`precheck of ${type} ${id ?? "(new)"} did not finish:`, error);
  }
}

/**
 * The step every save ends with: settle the row unless the wall already let
 * it through. `status` is the row's moderation_status as the write returned
 * it, so the common case (a clean edit) costs nothing more.
 */
export async function settleAfterWrite(
  type: AutoTarget,
  id: string,
  status: string | null | undefined,
): Promise<AutoOutcome> {
  if (status === "ok") return "ok";
  return checkTarget(type, id);
}

/** How many freshly written rows one request checks itself. The rest are the
 *  sweep's: each check is several calls out, and a request may make only so
 *  many. */
const INLINE_CHECKS = 8;

/** After a bulk write (a CSV import): check the first few rows now, together,
 *  and leave the rest pending for the sweep. */
export async function checkMany(type: AutoTarget, ids: readonly string[]): Promise<void> {
  await Promise.all(ids.slice(0, INLINE_CHECKS).map((id) => checkTarget(type, id)));
}

export type SweepReport = {
  /** Rows looked at in this run. */
  checked: number;
  /** How they came out, by outcome. */
  outcomes: Partial<Record<AutoOutcome, number>>;
  /** True when the caller should run again straight away. */
  more: boolean;
  /** Dry run only: what each waiting row would become, nothing applied. */
  preview?: { type: AutoTarget; id: string; title: string; would: Verdict }[];
};

/** How many rows one sweep takes. Bounded by what one Worker request may do:
 *  each row is a handful of database calls and up to a call per new file. */
const SWEEP_BATCH = 8;

/** The worst verdict among a row's parts, or null while one is unjudged. */
function wouldBe(parts: Parts, judged: Judged): Verdict | null {
  const subjects = [
    ...(parts.text_subject ? [parts.text_subject] : []),
    ...parts.media.map((part) => part.subject),
  ];
  let worst: Verdict = "clean";
  for (const subject of subjects) {
    const verdict = judged.get(subject)?.verdict;
    if (!verdict) return null;
    if (verdict === "violation") worst = "violation";
    else if (verdict === "unsure" && worst === "clean") worst = "unsure";
  }
  return worst;
}

/**
 * One run of the worklist (moderation_due): everything waiting on the check,
 * oldest first.
 *
 * `dryRun` judges the waiting rows and reports what each would become without
 * settling any of them. It is how the first run against existing content is
 * looked at before anything is hidden.
 */
export async function sweep(options: { dryRun?: boolean } = {}): Promise<SweepReport> {
  const report: SweepReport = { checked: 0, outcomes: {}, more: false };
  const admin = createAdminClient();
  const limit = options.dryRun ? SWEEP_BATCH * 4 : SWEEP_BATCH;
  const { data: due, error } = await admin.rpc("moderation_due", { p_limit: limit + 1 });
  // The wall's migration is not applied here yet: there is no worklist, and
  // nothing is being held against one. Answered quietly so the schedule that
  // calls this stays green until it is.
  if (error?.code === "PGRST202") return report;
  if (error) throw new Error(`reading the worklist failed: ${error.message}`);

  const rows = (due ?? []).filter((row) => isAutoTarget(row.target_type)).slice(0, limit);
  if (options.dryRun) report.preview = [];
  let settledAny = false;

  for (const row of rows) {
    const type = row.target_type as AutoTarget;
    report.checked += 1;
    if (options.dryRun) {
      try {
        const claimed = await claim(type, row.target_id);
        if (!claimed) continue;
        const would = wouldBe(claimed, await judgeParts(type, claimed));
        if (would) report.preview?.push({ type, id: row.target_id, title: claimed.title, would });
      } catch (error) {
        log(`dry run of ${type} ${row.target_id} did not finish:`, error);
      }
      continue;
    }
    const outcome = await checkTarget(type, row.target_id);
    report.outcomes[outcome] = (report.outcomes[outcome] ?? 0) + 1;
    if (outcome !== "pending") settledAny = true;
  }

  // Only worth calling again if this run got somewhere: with the classifier
  // down every row stays waiting, and a caller told "more" would spin.
  report.more = !options.dryRun && settledAny && (due ?? []).length > limit;
  return report;
}

/**
 * Record that a stored image is one the classifier cannot fully see (an SVG,
 * an AVIF, an animation), so any row that uses it is held for a person rather
 * than judged on what a classifier could make of it.
 *
 * Called by the upload routes, which hold the bytes and are the only place
 * that can tell. Returns false when the fact could not be recorded: the
 * caller must then refuse the upload, because an animation nobody flagged
 * would be approved on its first frame.
 */
export async function holdForPerson(key: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("moderation_checks").upsert(
      { subject: `image:${key}`, verdict: "unsure", source: "upload" },
      { onConflict: "subject", ignoreDuplicates: true },
    );
    if (!error) return true;
    // The wall's migration is not applied here yet: there is no approved list
    // and nothing reads one, so there is nothing to hold the file against.
    if (error.code === "PGRST205" || error.code === "42P01") return true;
    log("could not hold an upload for review:", error.message);
    return false;
  } catch (error) {
    log("could not hold an upload for review:", error);
    return false;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A standalone verdict: for content that is checked before it is stored and
 *  refused if not clean, so it never needs a pending state. */
export type StandaloneVerdict = PartVerdict | null;

async function remembered(subject: string, judge: () => Promise<ClassifyResult>): Promise<StandaloneVerdict> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("moderation_checks")
      .select("subject, verdict, ground, paths")
      .eq("subject", subject)
      .maybeSingle();
    // The wall's migration is not applied here yet: there is no approved list
    // and nothing is being held against one, so this check is not on either.
    if (error?.code === "PGRST205" || error?.code === "42P01") {
      return { verdict: "clean", ground: null, paths: [] };
    }
    if (error) throw new Error(`reading the approved list failed: ${error.message}`);
    const stored = storedVerdictSchema.safeParse(data);
    if (stored.success) {
      return { verdict: stored.data.verdict, ground: stored.data.ground, paths: stored.data.paths };
    }
    const verdict = await judge();
    if (!verdict) return null;
    // An answer that could not be written down is no answer: for a handle or
    // a picture the record IS the approval (the public directory reads it).
    const { error: recordError } = await admin.from("moderation_checks").upsert(
      {
        subject,
        verdict: verdict.verdict,
        ground: verdict.ground,
        paths: verdict.paths,
        source: "model",
        model: MODERATION_MODEL,
      },
      { onConflict: "subject", ignoreDuplicates: true },
    );
    if (recordError) throw new Error(`recording the verdict failed: ${recordError.message}`);
    return verdict;
  } catch (error) {
    log("standalone check did not finish:", error);
    return null;
  }
}

/**
 * Judge a few named fields of seller text that are not part of a moderated
 * row (the trader name, the bio, the shipping terms). Null means no answer
 * could be obtained, which a caller must treat as "not approved".
 */
export async function checkSellerText(fields: Record<string, string>): Promise<StandaloneVerdict> {
  const lines = Object.entries(fields)
    .filter(([, value]) => value.trim() !== "")
    .map(([field, value]) => `${field}=${value}`)
    .sort();
  if (lines.length === 0) return { verdict: "clean", ground: null, paths: [] };
  // Its own namespace: these fingerprints are worked out here, the rows' are
  // worked out by the database.
  const subject = `text:seller:${await sha256(lines.join("\n"))}`;
  return remembered(subject, () => classifyText("seller", lines));
}

/**
 * Judge a handle. Recorded against the handle itself, lowercased, which is the
 * subject the public profile directory looks up before it lists a profile
 * (sync_profile_directory, 20261013_marketplace_moderation): an approval is
 * for these characters, whoever wrote them and by whatever route.
 */
export async function checkHandle(handle: string): Promise<StandaloneVerdict> {
  const name = handle.trim().toLowerCase();
  if (name === "") return { verdict: "clean", ground: null, paths: [] };
  return remembered(`handle:${name}`, () => classifyText("seller", [`username=${name}`]));
}

/**
 * Judge one profile picture. `shownAt` is the exact value kept in
 * profiles.avatar_url, and the approval is recorded against it: the directory
 * shows a picture only when that URL is on the list. So it must be a URL whose
 * bytes only the platform can change (an object this server stored).
 * `fetchUrl` is where the classifier can read it, which for a private bucket
 * is a presigned URL and not the same thing.
 */
export async function checkAvatar(shownAt: string, fetchUrl: string): Promise<StandaloneVerdict> {
  return remembered(`avatar:${shownAt}`, () => classifyMedia("image", shownAt, fetchUrl));
}
