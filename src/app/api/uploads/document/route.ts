import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { buildObjectKey, hasR2Credentials, presignPutUrl } from "@/lib/r2";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES } from "@/lib/validation/product";
import { singleLineText } from "@/lib/validation/inputs";
import { sniffFile } from "@/lib/uploads/sniff";
import { peekStream } from "@/lib/uploads/peek";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

/** Enough for every container signature the sniffer checks (longest reaches byte 11). */
const SNIFF_BYTES = 12;

/**
 * POST /api/uploads/document: a product's PUBLIC document, which is to say a
 * manual, a certificate of conformity, a safety data sheet, a spec sheet.
 *
 * SEPARATE FROM /api/uploads/file ON PURPOSE, and every difference is a
 * tightening. A digital file is the thing a buyer pays for; a document is
 * offered to anyone who opens the product page, before any purchase and
 * without a session, so it is the more exposed of the two and gets the
 * stricter rules:
 *
 *   - PDF only (DOCUMENT_CONTENT_TYPES), against the file route's twelve types.
 *   - 20 MB, against 200 MB. A product may carry DOCUMENTS_MAX of these and
 *     every page view offers all of them, so this is a public egress budget,
 *     not just a disk one.
 *   - The head bytes must BE a PDF, not merely fail to contradict the claim.
 *     The file route has to stay lenient (text/plain has no signature); here
 *     the one accepted type has a magic number, so anything that is not `%PDF`
 *     is refused outright.
 *   - Its own rate-limit budget, so attaching manuals cannot exhaust the
 *     digital-download budget and a compromised session cannot use the public
 *     surface to spend the paid one.
 *   - Its own `documents/` key prefix, so a public manual and a paywalled
 *     download are never indistinguishable by key, which is what lets
 *     verifyUploadedObject apply these caps at save time.
 *
 * Streamed rather than buffered, like the file route: 20 MB is not something
 * to hold in a Worker's memory once a handful of sellers upload at once.
 *
 * The size and stored type are re-checked server-side before the key is
 * attached to a product (verifyNewKeys in lib/products/actions.ts), which
 * remains the boundary that decides what reaches a buyer: a presigned PUT can
 * bind neither Content-Type nor Content-Length, so nothing here is the last
 * word.
 */

const filenameSchema = singleLineText({ label: "A filename", max: 200 });

function bad(status: number, error: string, fix?: string) {
  return Response.json({ error, fix }, { status });
}

export async function POST(request: Request) {
  const account = await getActiveAccount();
  if (!account) return bad(401, "Sign in to upload documents.");
  if (!can(account.role, "products.write")) {
    return bad(403, "You don't have permission to upload here.");
  }
  if (!(await rateLimit("document_upload", RATE_LIMITS.documentUpload))) {
    return bad(429, "Too many document uploads right now. Try again shortly.");
  }
  if (!hasR2Credentials()) {
    console.error(
      "[uploads] R2 is not configured — set R2_ACCOUNT_ID, R2_BUCKET_NAME, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local (see .env.example).",
    );
    return bad(503, "Uploads are not configured yet. Contact the site owner.");
  }

  // Metadata rides in the query string (percent-encoded, so a filename with
  // any character survives); the body is the file and nothing else.
  const params = new URL(request.url).searchParams;
  const contentType = params.get("contentType") ?? "";
  const allowed: readonly string[] = DOCUMENT_CONTENT_TYPES;
  if (!allowed.includes(contentType)) {
    return bad(
      415,
      "Documents have to be PDFs.",
      "Export the manual or certificate as a PDF, then upload it.",
    );
  }

  const filename = filenameSchema.safeParse(params.get("filename") ?? "");
  if (!filename.success) return bad(400, "That filename can't be used.");

  // R2 needs a length, and it is also the only chance to reject an oversized
  // upload BEFORE streaming it. The stored object's true size is re-checked at
  // save time, so a dishonest header cannot get a document attached.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) {
    return bad(411, "That upload is missing its length.", "Try again.");
  }
  if (declared > DOCUMENT_MAX_BYTES) {
    const maxMb = Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024);
    return bad(413, "That document is too large.", `Use a PDF under ${maxMb} MB.`);
  }
  if (!request.body) return bad(400, "No document was uploaded.");

  // POSITIVE identification, not the file route's "is the claim a provable
  // lie". One accepted type, and it has a magic number, so the bytes must
  // actually say %PDF. A renamed executable, a zip, an HTML page: all refused
  // here rather than stored under a type nothing will scrutinise and then
  // handed to whoever opens the product page.
  const { head, body } = await peekStream(request.body, SNIFF_BYTES);
  if (sniffFile(head) !== "pdf") {
    return bad(
      415,
      "That file isn't a PDF.",
      "Re-export it as a PDF. Renaming a file does not change its format.",
    );
  }

  const key = buildObjectKey("document", account.userId, filename.data);

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
      console.error("[uploads] document store failed", res.status);
      return bad(502, "The document could not be stored.", "Try again in a moment.");
    }
  } catch (error) {
    console.error("[uploads] document stream failed", error);
    return bad(502, "The document could not be stored.", "Try again in a moment.");
  }

  return Response.json({ key });
}
