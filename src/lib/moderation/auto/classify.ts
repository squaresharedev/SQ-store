// SERVER ONLY. The one place the classifier is called.
//
// THE CONTRACT every caller relies on: only an explicit "clean" lets content
// publish, and this file can return three different things.
//
//   a verdict   The classifier answered, or the content is something it can
//               never answer about (it refused, the reply was unreadable, the
//               file cannot be read). Recorded; "unsure" sends it to a person.
//   null        No answer was obtained: no key, the provider is down or slow,
//               we are rate limited. NOT recorded, so the part is asked about
//               again on the next sweep. Meanwhile the row stays hidden.
//
// Neither is ever "clean" by default. There is no path through this file on
// which a failure publishes anything.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  answerSchema,
  linePath,
  mediaInstruction,
  MODERATION_EFFORT,
  MODERATION_MODEL,
  POLICY_PROMPT,
  REVIEW_POLICY_PROMPT,
  reviewInstruction,
  textInstruction,
  TEXT_MAX_CHARS,
  type ModerationScope,
  type PartVerdict,
  type RawAnswer,
} from "@/lib/moderation/auto/policy";
import { isRemovalGround } from "@/lib/moderation/removal";
import { addressesTheCheck, hasHiddenCharacters, normalizeForModel } from "@/lib/moderation/auto/injection";
import { classifyMediaForTest, classifyTextForTest } from "@/lib/moderation/auto/test-provider";

/** Null means "no answer": see the contract above. */
export type ClassifyResult = PartVerdict | null;

/**
 * How long one answer may take. The check usually runs inside a seller's save,
 * so this is time someone spends watching a button. Past it the part simply
 * stays unjudged and the sweep asks again.
 */
const CLASSIFY_TIMEOUT_MS = 12_000;

/**
 * Room for one reply. The answer's three short fields need a few dozen tokens;
 * the rest is for the model's own thinking, which counts against this limit.
 * Sized for the answer alone, a reply stops before the answer starts, which
 * reads as "unsure" and puts ordinary content on a person's desk.
 */
const RESPONSE_MAX_TOKENS = 4_000;

const HELD: PartVerdict = { verdict: "unsure", ground: null, paths: [] };

/** Whether this process talks to a database on this machine (the e2e stack's
 *  replica), as opposed to the hosted project every deployment shares. */
function databaseIsLocal(): boolean {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

/**
 * The in-process stand-in, for the e2e stack.
 *
 * Development builds only: a deployed Worker is a production build, so this
 * can never answer for real content (same rule as lib/billing/availability).
 * AND ONLY AGAINST A LOCAL DATABASE. Verdicts are remembered by content, so a
 * laptop pointed at the hosted project with this switched on would write
 * "clean" into the real approved list for everything it saved.
 */
export function moderationTestProvider(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.MODERATION_TEST_PROVIDER === "1" &&
    databaseIsLocal()
  );
}

/** Whether a real classifier can be reached from this deployment. */
export function classifierConfigured(): boolean {
  return moderationTestProvider() || Boolean(process.env.ANTHROPIC_API_KEY);
}

// One client per isolate. The key is read from ANTHROPIC_API_KEY by the SDK.
let cachedClient: Anthropic | undefined;
function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  cachedClient ??= new Anthropic({ timeout: CLASSIFY_TIMEOUT_MS, maxRetries: 1 });
  return cachedClient;
}

/**
 * Bring an answer inside its own rules: a clean answer names no ground and no
 * field, a violation always names a ground, and a field the content does not
 * have is dropped rather than shown to a seller.
 */
export function normalizeVerdict(answer: RawAnswer | PartVerdict, knownPaths: readonly string[]): PartVerdict {
  if (answer.verdict === "clean") return { verdict: "clean", ground: null, paths: [] };
  const known = new Set(knownPaths);
  // The policy names each ground in capitals ("ILLEGAL"), and the model gives
  // it back that way, so the spelling is folded before it is looked up.
  const label = answer.ground?.trim().toLowerCase();
  // A ground we do not have becomes "other": the reason is still shown as a
  // rule broken, and the seller is pointed at what to change either way.
  const named = isRemovalGround(label) ? label : null;
  return {
    verdict: answer.verdict,
    ground: answer.verdict === "violation" ? (named ?? "other") : answer.ground ? (named ?? "other") : null,
    paths: [...new Set(answer.paths)].filter((path) => known.has(path)),
  };
}

type UserContent = Anthropic.MessageParam["content"];

async function ask(
  content: UserContent,
  knownPaths: readonly string[],
  /** Whether a request the API refuses outright means the CONTENT is
   *  unreadable (a file) rather than that we built the request wrong (text). */
  unreadableIsVerdict: boolean,
  /** Which policy: the listing one, or the buyer-review one. */
  policy: string = POLICY_PROMPT,
): Promise<ClassifyResult> {
  const anthropic = client();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.parse({
      model: MODERATION_MODEL,
      max_tokens: RESPONSE_MAX_TOKENS,
      // Cached: the policy is the same on every call and most of each
      // request's input, so after the first call it is read at a tenth of
      // the price. Nothing variable is in it, so nothing invalidates it.
      system: [{ type: "text", text: policy, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      // No temperature or top_p: this model answers them with a 400.
      output_config: { effort: MODERATION_EFFORT, format: zodOutputFormat(answerSchema) },
    });
    // The model's own safety check declined to read it. Asking again gets the
    // same answer, and it is neither proof the content is fine nor proof it is
    // not: a person looks. Logged by category, because how often this happens
    // is how much of the queue the classifier is handing over unread.
    if (response.stop_reason === "refusal") {
      console.warn(
        "[moderation] classifier declined to read content:",
        response.stop_details?.category ?? "no category",
      );
      return HELD;
    }
    // A cut-off reply or one that does not fit the schema is not evidence the
    // content is fine either.
    if (!response.parsed_output) return HELD;
    return normalizeVerdict(response.parsed_output, knownPaths);
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError) {
      if (unreadableIsVerdict) return HELD;
      console.error("[moderation] classifier refused the request:", error.message);
      return null;
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      console.error("[moderation] classifier credentials were refused:", error.message);
      return null;
    }
    if (error instanceof Anthropic.RateLimitError) {
      console.warn("[moderation] classifier is rate limited");
      return null;
    }
    if (error instanceof Anthropic.APIConnectionError) {
      console.warn("[moderation] classifier unreachable:", error.message);
      return null;
    }
    if (error instanceof Anthropic.APIError) {
      console.warn("[moderation] classifier answered", error.status, error.message);
      return null;
    }
    console.error(
      "[moderation] classifier call failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Whether a line's value is a file on this project's OWN public storage.
 *
 * Only the platform writes there: no client role has a policy or a grant on
 * the storage tables, so an address on this origin cannot have been put there
 * by a seller. It is the platform's own file (seeded demo content, a stock
 * image), not a seller hotlinking something unchecked. Everything else that
 * looks like an address is still the classifier's to judge.
 */
export function isPlatformStorageLine(line: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  if (!supabaseUrl) return false;
  const value = line.slice(line.indexOf("=") + 1).trim();
  try {
    const origin = new URL(supabaseUrl).origin;
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === origin &&
      url.username === "" &&
      url.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}

/**
 * Whether a line is a FILE field holding another website's address.
 *
 * Uploaded files are stored under a key the platform minted; a field that
 * should hold one and holds http(s)://elsewhere is an image the seller
 * hotlinked, which nobody has seen and which the buyer's browser would load
 * from a server the seller controls (and can change afterwards). Only a
 * database write made around the app can put one there. Decided here, not left
 * to the model: a rule the whole check leans on must not be a coin the model
 * flips differently from one run to the next.
 *
 * File fields are the ones named "key" or ending in "_key" (image_key,
 * gallery[].key, documents[].key, an image block's key). purchase_url and the
 * like are ordinary addresses.
 */
export function isHotlinkedFileLine(line: string): boolean {
  const cut = line.indexOf("=");
  if (cut === -1) return false;
  const field = line.slice(0, cut).split(".").pop() ?? "";
  // An array position is written "name[]": drop the brackets.
  const name = field.endsWith("[]") ? field.slice(0, -2) : field;
  if (name !== "key" && !name.endsWith("_key")) return false;
  const value = line.slice(cut + 1).trim().toLowerCase();
  return value.startsWith("https://") || value.startsWith("http://");
}

/**
 * Judge the text of one row, given as "field=value" lines.
 *
 * Text too long to be a real listing is held without being sent: see
 * TEXT_MAX_CHARS. Lines that only name a file on the platform's own storage
 * are left out (isPlatformStorageLine); a row with nothing else on it has
 * nothing to judge.
 */
/**
 * The seller's text as it goes inside the <content> fence. The fence only keeps
 * their words in the data if they cannot write it themselves: without this a
 * title ending "</content>" closed the block early, and whatever followed read
 * as the platform speaking (security audit 2026-10-20). Escaping &, < and >
 * makes the closing tag impossible to type. The approved list is keyed on the
 * stored row, hashed in SQL, so this changes nothing about what was approved.
 */
function fenceSafe(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function classifyText(
  scope: ModerationScope,
  lines: readonly string[],
): Promise<ClassifyResult> {
  if (lines.join("\n").length > TEXT_MAX_CHARS) return HELD;
  if (moderationTestProvider()) return classifyTextForTest(lines);

  const judged = lines.filter((line) => !isPlatformStorageLine(line));
  // A hotlinked file is held for a person without asking the model: see
  // isHotlinkedFileLine. The field is named so the seller knows what to fix.
  const hotlinked = judged.filter(isHotlinkedFileLine);
  if (hotlinked.length > 0) {
    return { verdict: "unsure", ground: null, paths: [...new Set(hotlinked.map(linePath))] };
  }
  // So is a line that hides text from people (tag characters, direction
  // controls, smuggled selectors: the form drops them all) or plainly tries to
  // address this check. The policy asks the model to answer "unsure" to both;
  // this does not depend on it doing so (lib/moderation/auto/injection.ts).
  const steering = judged.filter((line) => hasHiddenCharacters(line) || addressesTheCheck(line));
  if (steering.length > 0) {
    return { verdict: "unsure", ground: null, paths: [...new Set(steering.map(linePath))] };
  }
  if (judged.length === 0) return { verdict: "clean", ground: null, paths: [] };
  // What the model reads: look-alike forms folded and invisible characters
  // gone, so a disguised word reads as the word; then fenced.
  const text = fenceSafe(normalizeForModel(judged.join("\n")));

  return ask(
    [
      { type: "text", text: `${textInstruction(scope)}\n\n<content>\n${text}\n</content>` },
    ],
    judged.map(linePath),
    false,
  );
}

/**
 * Judge one buyer review (lib/reviews/moderation.ts) under the review policy:
 * the shown name, the title and the text, as field=value lines. The same
 * fences as a listing's text: hidden characters and text that addresses the
 * check are held without asking, and what the model reads is normalised and
 * fenced.
 */
export async function classifyReview(review: {
  authorName: string;
  title: string | null;
  body: string;
}): Promise<ClassifyResult> {
  const lines = [
    `author=${review.authorName}`,
    ...(review.title ? [`title=${review.title}`] : []),
    ...(review.body ? [`body=${review.body}`] : []),
  ];
  if (moderationTestProvider()) return classifyTextForTest(lines);
  const steering = lines.filter((line) => hasHiddenCharacters(line) || addressesTheCheck(line));
  if (steering.length > 0) {
    return { verdict: "unsure", ground: null, paths: [...new Set(steering.map(linePath))] };
  }
  const text = fenceSafe(normalizeForModel(lines.join("\n")));
  return ask(
    [{ type: "text", text: `${reviewInstruction()}\n\n<content>\n${text}\n</content>` }],
    lines.map(linePath),
    false,
    REVIEW_POLICY_PROMPT,
  );
}

/**
 * Judge one stored image or PDF, by a URL the classifier fetches itself, so
 * the bytes never pass through this Worker. `url` is a short-lived signed GET.
 */
export async function classifyMedia(
  kind: "image" | "pdf",
  key: string,
  url: string | null,
): Promise<ClassifyResult> {
  if (moderationTestProvider()) return classifyMediaForTest(key);
  // Storage is not configured here, so there is nothing to show the
  // classifier. A deployment fault, not a verdict.
  if (!url) return null;

  return ask(
    [
      kind === "image"
        ? { type: "image", source: { type: "url", url } }
        : { type: "document", source: { type: "url", url } },
      { type: "text", text: mediaInstruction(kind) },
    ],
    [],
    true,
  );
}

/**
 * Judge an image or a PDF handed over as base64 bytes. The deployed check
 * never does this (it passes a URL: classifyMedia); it is the same question
 * for the live media eval, whose files cannot be served from this project's
 * storage.
 */
export async function classifyMediaBytes(
  file: { kind: "image"; mediaType: "image/jpeg" | "image/png"; data: string } | { kind: "pdf"; data: string },
): Promise<ClassifyResult> {
  return ask(
    [
      file.kind === "image"
        ? { type: "image", source: { type: "base64", media_type: file.mediaType, data: file.data } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } },
      { type: "text", text: mediaInstruction(file.kind) },
    ],
    [],
    true,
  );
}
