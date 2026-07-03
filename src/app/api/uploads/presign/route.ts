import { getUser } from "@/lib/auth/session";
import { buildObjectKey, hasR2Credentials, presignPutUrl } from "@/lib/r2";
import { presignRequestSchema } from "@/lib/validation/product";

/**
 * POST /api/uploads/presign — mint a short-lived presigned PUT URL for a
 * direct-to-R2 upload. Auth required; the object key is built server-side from
 * the session's user id (the client never chooses its own key).
 *
 * kind/type/size are validated here for early UX rejection ONLY — a presigned
 * PUT can bind neither Content-Type nor Content-Length, so these are not the
 * security boundary. The real enforcement is the HEAD re-check at save time
 * (verifyUploadedObject in lib/products/actions.ts).
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in to upload files." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = presignRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Friendly, non-leaky reason: the only user-fixable failures are type/size.
    const paths = new Set(
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
    const error = paths.has("contentType")
      ? "That file type is not supported."
      : paths.has("size")
        ? "That file is too large."
        : "Invalid upload request.";
    return Response.json({ error }, { status: 400 });
  }

  // Distinguish "not set up yet" from a genuine transient failure. Missing R2
  // env is an operator/config problem, not something the seller can fix by
  // retrying — say so plainly and log the actionable hint server-side.
  if (!hasR2Credentials()) {
    console.error(
      "[uploads] R2 is not configured — set R2_ACCOUNT_ID, R2_BUCKET_NAME, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local (see .env.example).",
    );
    return Response.json(
      { error: "File uploads are not configured yet. Contact the site owner." },
      { status: 503 },
    );
  }

  const { kind, filename, contentType } = parsed.data;
  const key = buildObjectKey(kind, user.id, filename);

  try {
    const url = await presignPutUrl(key, contentType);
    return Response.json({ url, key });
  } catch (error) {
    console.error("[uploads] presign failed", error);
    return Response.json(
      { error: "Uploads are not available right now. Try again later." },
      { status: 500 },
    );
  }
}
