import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { buildObjectKey, hasR2Credentials, presignPutUrl } from "@/lib/r2";
import {
  DIGITAL_FILE_CONTENT_TYPES,
  DIGITAL_FILE_MAX_BYTES,
} from "@/lib/validation/product";
import { singleLineText } from "@/lib/validation/inputs";
import { fileBytesContradictType } from "@/lib/uploads/sniff";
import { peekStream } from "@/lib/uploads/peek";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

/** Enough for every container signature the sniffer checks (longest reaches byte 11). */
const SNIFF_BYTES = 12;

/**
 * POST /api/uploads/file — upload a product's digital file THROUGH the server.
 *
 * Replaces a presigned browser PUT straight to R2. That was cross-origin, so
 * it needed the bucket's CORS allowlist to name every origin the app is served
 * from; ours names one, so uploads died at preflight on every dev port and
 * every deployed domain. Same-origin has no preflight to fail.
 *
 * STREAMED, NOT BUFFERED. A digital file runs to 200 MB, so the body is piped
 * from the request straight into R2 — it is never held in memory. Two details
 * make that work:
 *   - The upload is authorised by a presigned URL (auth in the query string),
 *     so no payload hash is needed. Signing the body would mean reading it.
 *   - Content-Length is forwarded explicitly. R2 rejects a chunked PUT with
 *     411 Length Required.
 *
 * The file's bytes are inspected only at the HEAD, unlike an image (see
 * /api/uploads/image, which holds the whole file, sniffs it and moderates it).
 * A 200 MB body cannot be buffered in a Worker, so this peeks at the first few
 * bytes, refuses a declared type the container signature contradicts, and
 * forwards the stream untouched. That catches the case that matters — binary
 * content stored under a type nothing will scrutinise — without pretending to
 * be full content inspection.
 *
 * The size and stored type are re-checked server-side again before the key is
 * attached to a product (verifyUploadedObject in lib/products/actions.ts),
 * which remains the boundary that actually decides what reaches a buyer.
 */

const filenameSchema = singleLineText({ label: "A filename", max: 200 });

function bad(status: number, error: string, fix?: string) {
  return Response.json({ error, fix }, { status });
}

export async function POST(request: Request) {
  const account = await getActiveAccount();
  if (!account) return bad(401, "Sign in to upload files.");
  if (!can(account.role, "products.write")) {
    return bad(403, "You don't have permission to upload here.");
  }
  // Its own budget, not the shared upload one: each call here authorises up to
  // 200 MB into R2, so it is priced far more tightly than an image upload.
  if (!(await rateLimit("file_upload", RATE_LIMITS.fileUpload))) {
    return bad(429, "Too many file uploads right now. Try again shortly.");
  }
  if (!hasR2Credentials()) {
    console.error(
      "[uploads] R2 is not configured — set R2_ACCOUNT_ID, R2_BUCKET_NAME, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local (see .env.example).",
    );
    return bad(503, "File uploads are not configured yet. Contact the site owner.");
  }

  // Metadata rides in the query string (percent-encoded, so a filename with
  // any character survives); the body is the file and nothing else.
  const params = new URL(request.url).searchParams;
  const contentType = params.get("contentType") ?? "";
  const allowed: readonly string[] = DIGITAL_FILE_CONTENT_TYPES;
  if (!allowed.includes(contentType)) {
    return bad(
      415,
      "That file type is not supported.",
      "Use a ZIP, PDF, EPUB, MP3, WAV, MP4, JPEG, PNG, WebP, or TXT file.",
    );
  }

  const filename = filenameSchema.safeParse(params.get("filename") ?? "");
  if (!filename.success) return bad(400, "That filename can't be used.");

  // R2 needs a length, and it is also the only chance to reject an oversized
  // upload BEFORE streaming it. The stored object's true size is re-checked at
  // save time, so a dishonest header cannot get a file attached to a product.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) {
    return bad(411, "That upload is missing its length.", "Try again.");
  }
  if (declared > DIGITAL_FILE_MAX_BYTES) {
    const maxMb = Math.round(DIGITAL_FILE_MAX_BYTES / 1024 / 1024);
    return bad(
      413,
      "That file is too large.",
      `Use a file under ${maxMb} MB.`,
    );
  }
  if (!request.body) return bad(400, "No file was uploaded.");

  // Look at the leading bytes before storing anything. This route cannot sniff
  // the way the image route does — it never holds the file — so it peeks at the
  // head and forwards a stream that replays it, leaving the body byte-identical
  // for the Content-Length below. The question answered here is narrow: is the
  // declared type a PROVABLE lie? A zip announcing itself as text/plain is how
  // a binary payload gets stored under a type nothing will scrutinise.
  const { head, body } = await peekStream(request.body, SNIFF_BYTES);
  if (head.byteLength >= SNIFF_BYTES && fileBytesContradictType(head, contentType)) {
    return bad(
      415,
      "That file's contents don't match its type.",
      "Re-export the file, or pick the format that matches what you're uploading.",
    );
  }

  const key = buildObjectKey("file", account.userId, filename.data);

  try {
    const url = await presignPutUrl(key, contentType);
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(declared),
      },
      body,
      // Required to send a stream as a request body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!res.ok) {
      console.error("[uploads] file store failed", res.status);
      return bad(502, "The file could not be stored.", "Try again in a moment.");
    }
  } catch (error) {
    console.error("[uploads] file stream failed", error);
    return bad(502, "The file could not be stored.", "Try again in a moment.");
  }

  return Response.json({ key });
}
