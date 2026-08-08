/**
 * CONTENT MODERATION.
 *
 * A Cloudflare Workers AI vision model classifies every product image before it
 * reaches storage. It is OFF BY DEFAULT (MODERATION_ENABLED=true switches it
 * on) — see {@link moderationEnabled} for why that default is deliberate rather
 * than timid.
 *
 * Read {@link MODERATION_MODEL} before trusting this for anything: Workers AI
 * has no purpose-built abuse classifier, so this is a general vision model
 * answering a policy question. It is a first-pass filter, and explicitly not a
 * CSAM control.
 *
 * WHY THIS SHAPE
 *
 * Moderation is only possible where the platform can see the bytes. Product
 * images used to go browser -> R2 directly (presigned PUT), so the server never
 * held the image and there was no point at which anything could be inspected,
 * held, or refused — a moderation system could only ever have run after the
 * image was already public. Images now upload THROUGH the server
 * (app/api/uploads/image), and that route calls {@link moderateUpload} before
 * a single byte reaches storage.
 *
 * The presign path is deliberately restricted to digital FILES, so there is no
 * second route by which an image could reach a product without passing here.
 * That restriction is the moderation guarantee — remove it and moderation
 * becomes bypassable by a crafted client.
 *
 * THE THREE VERDICTS, all already handled by the upload route:
 *
 *   allow  -> stored and usable immediately
 *   reject -> never stored; the uploader is told why
 *   review -> stored under the quarantine prefix and NOT usable; it is not
 *             linked to a product, so it cannot be displayed while it waits
 *
 * A provider that is slow or down returns `review`, not `allow`: nothing
 * publishes on the strength of an answer we never got. The full failure policy
 * is on {@link moderateUpload}.
 *
 * SWAPPING PROVIDERS. Replace {@link classify} and {@link interpretModelVerdict}.
 * No call site changes; the verdict union is the contract.
 */

/** What the platform may do with a piece of uploaded media. */
export type ModerationVerdict =
  | { decision: "allow" }
  /** Refuse outright. `reason` is shown to the uploader, so keep it human. */
  | { decision: "reject"; reason: string }
  /** Hold for a human. `reason` is internal, for the review queue. */
  | { decision: "review"; reason: string };

/**
 * What is being moderated. `kind` exists so a future provider can apply
 * different policy per surface (a product photo and an avatar are not judged
 * the same way) without changing this signature again.
 */
export type ModerationSubject = {
  kind: "product-image";
  /** The real bytes, after magic-byte sniffing — not the client's claim. */
  bytes: Uint8Array;
  /** The sniffed content type, likewise. */
  contentType: string;
  /** Who uploaded it, and which store account it is destined for. */
  uploaderId: string;
  accountId: string;
};

/**
 * Cloudflare Workers AI vision model used as the first-pass classifier.
 *
 * WHAT THIS IS AND IS NOT. Workers AI ships no dedicated NSFW or abuse
 * classifier: the catalogue's only image-classification model is
 * `@cf/microsoft/resnet-50`, which labels ImageNet objects ("golden retriever"),
 * and `@cf/meta/llama-guard-3-8b` is a TEXT safety model. So this asks a general
 * vision-language model a policy question instead. That is a real technique and
 * catches obvious adult and graphic content, but it is a probabilistic
 * first-pass filter, NOT a compliance control.
 *
 * In particular it is NOT a CSAM control. That requires a purpose-built,
 * hash-matching service — Cloudflare's CSAM Scanning Tool is a separate product
 * from Workers AI. Do not let this function's existence stand in for it.
 */
const MODERATION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

/**
 * How long a verdict may take before the upload gives up on it.
 *
 * This call is INLINE on the upload path: every second here is a second the
 * seller watches a spinner. An 11B vision model is not fast, so the ceiling is
 * generous enough to usually succeed and short enough not to look hung. A
 * timeout is not an allow — see {@link moderateUpload}.
 */
const MODERATION_TIMEOUT_MS = 8_000;

/** Categories the model is asked to decide between. Order is not significance. */
const REJECT_CATEGORIES = new Set([
  "sexual",
  "graphic_violence",
  "gore",
  "hate_symbol",
]);

/**
 * The instruction sent with every image. Deliberately demands a tiny, fixed
 * vocabulary rather than prose: the parse below has to be boring, and a model
 * given room to explain itself will use it.
 */
const MODERATION_PROMPT = [
  "You are a content-safety filter for an e-commerce product catalogue.",
  "Classify this product image with EXACTLY ONE of these labels and nothing else:",
  "clean, sexual, graphic_violence, gore, hate_symbol, unclear",
  "Use 'clean' for ordinary product photography, artwork, packaging, or text.",
  "Use 'unclear' only if the image is too ambiguous or corrupted to judge.",
  "Reply with the single label. No punctuation, no explanation.",
].join(" ");

/** Human-facing copy per rejected category. The uploader sees these. */
const REJECT_COPY: Record<string, string> = {
  sexual: "That image looks explicit, so it can't be used on a product.",
  graphic_violence: "That image looks graphically violent, so it can't be used.",
  gore: "That image looks graphically violent, so it can't be used.",
  hate_symbol: "That image appears to contain hate symbolism, so it can't be used.",
};

/**
 * Is the classifier switched on?
 *
 * Off by default, and that default is deliberate. The Workers AI request shape
 * for a vision model cannot be verified from this repo (the per-model types
 * live in @cloudflare/workers-types, which is not a dependency, and the binding
 * only exists on the Cloudflare runtime), so the first real proof this call is
 * correctly formed comes from a deploy. Shipping it on by default would make
 * that experiment run against live sellers' uploads.
 *
 * Turn on with MODERATION_ENABLED=true once a deployed smoke test shows a clean
 * image coming back "clean".
 */
function moderationEnabled(): boolean {
  return process.env.MODERATION_ENABLED === "true";
}

/**
 * Map the model's raw answer onto a verdict.
 *
 * Pure and exported so the POLICY is testable without a Cloudflare binding —
 * which matters, because the policy is the part with security consequences and
 * the network call is the part that cannot be tested here.
 *
 * Anything unrecognised is `review`, never `allow`: an answer we cannot read is
 * not evidence that an image is fine.
 */
export function interpretModelVerdict(raw: unknown): ModerationVerdict {
  const text = typeof raw === "string" ? raw : "";
  // The model is asked for one bare label; tolerate stray case, punctuation and
  // whitespace, but do not go hunting for a label inside a sentence — a reply
  // that discursive means it ignored the instruction and should be reviewed.
  const label = text.trim().toLowerCase().replace(/[^a-z_]/g, "");

  if (label === "clean") return { decision: "allow" };
  if (REJECT_CATEGORIES.has(label)) {
    return {
      decision: "reject",
      reason: REJECT_COPY[label] ?? "That image can't be used on a product.",
    };
  }
  return {
    decision: "review",
    reason: `Classifier returned an unusable answer: ${
      text.trim().slice(0, 80) || "(empty)"
    }`,
  };
}

/** The one place the Workers AI binding is touched. */
async function classify(subject: ModerationSubject): Promise<unknown> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = await getCloudflareContext({ async: true });
  const ai = (env as Record<string, unknown>).AI as
    | { run: (model: string, input: unknown) => Promise<{ response?: string }> }
    | undefined;

  if (!ai) {
    throw new Error(
      "MODERATION_ENABLED is true but no AI binding is present. Add an `ai` binding to wrangler.jsonc.",
    );
  }

  const result = await ai.run(MODERATION_MODEL, {
    // Workers AI vision models take raw bytes as a plain number array.
    image: Array.from(subject.bytes),
    prompt: MODERATION_PROMPT,
    max_tokens: 16,
  });
  return result?.response;
}

/**
 * Decide what may happen to an upload.
 *
 * FAILURE POLICY, which is the whole design:
 *
 *   disabled            -> allow. The pre-classifier behaviour, unchanged.
 *   enabled, no binding -> throw. The route turns that into a 503 and the
 *                          upload fails loudly, because "configured to moderate
 *                          but unable to" must never silently publish.
 *   enabled, call fails -> review. A provider that is down, slow, or answering
 *   or times out           in a shape we cannot read is not permission to
 *                          publish; the image is quarantined instead.
 *   enabled, answered   -> whatever {@link interpretModelVerdict} decides.
 *
 * Note the asymmetry: only an explicit "clean" produces `allow`. Every other
 * path either holds the image or fails the request.
 */
export async function moderateUpload(
  subject: ModerationSubject,
): Promise<ModerationVerdict> {
  if (!moderationEnabled()) return { decision: "allow" };

  let raw: unknown;
  try {
    raw = await Promise.race([
      classify(subject),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Classifier did not answer in ${MODERATION_TIMEOUT_MS}ms.`)),
          MODERATION_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A missing binding is a DEPLOYMENT fault, not a content decision: rethrow
    // so it surfaces as a 503 rather than quietly quarantining every upload.
    if (message.includes("no AI binding")) throw error;
    console.warn("[moderation] classifier unavailable, holding for review:", message);
    return { decision: "review", reason: `Classifier unavailable: ${message}` };
  }

  return interpretModelVerdict(raw);
}

/**
 * Key prefix for media held pending human review. Kept separate from the live
 * prefixes so that a quarantined object can never satisfy
 * `isOwnedObjectKey(..., "image", ...)` and therefore can never be attached to
 * a product, whatever else goes wrong.
 */
export const QUARANTINE_PREFIX = "quarantine";
