import {
  DIGITAL_FILE_CONTENT_TYPES,
  IMAGE_CONTENT_TYPES,
  maxBytesForKind,
  type UploadKind,
} from "@/lib/validation/product";
import { uploadFailed, type ActionError } from "@/lib/errors";

/**
 * Thrown by uploadToR2: carries a structured ActionError (message + fix) so
 * callers can show the user exactly WHY the upload failed (unsupported type,
 * over the size cap, connection dropped, missing permission) instead of the
 * browser's bare "Failed to fetch".
 */
export class UploadError extends Error {
  readonly info: ActionError;
  constructor(info: ActionError) {
    super(info.message);
    this.name = "UploadError";
    this.info = info;
  }
}

const TYPE_FIX: Record<UploadKind, string> = {
  image: "Use a JPEG, PNG, WebP, GIF, or AVIF image.",
  file: "Use a ZIP, PDF, EPUB, MP3, WAV, MP4, JPEG, PNG, WebP, or TXT file.",
};

function allowedTypes(kind: UploadKind): readonly string[] {
  return kind === "image" ? IMAGE_CONTENT_TYPES : DIGITAL_FILE_CONTENT_TYPES;
}

/** Fix line for a failed presign response, keyed off the HTTP status. */
function presignFix(status: number): string {
  if (status === 401) return "Sign in again, then retry.";
  if (status === 403) {
    return "Only the store owner can change roles. Ask them to upgrade you to Editor in Team settings.";
  }
  return "Check the file and try again. If it keeps failing, refresh the page.";
}

/**
 * Client-side upload helper: ask the server for a presigned PUT URL, send the
 * file straight to R2, return the object key to store. The server (not this
 * code) is the security boundary; it authenticates, validates kind/type/size,
 * and mints the key. The local type/size checks here exist so the user gets
 * the specific reason immediately, before any network round trip.
 *
 * Every failure path throws {@link UploadError} with a message + fix.
 */
export async function uploadToR2(file: File, kind: UploadKind): Promise<string> {
  const noun = kind === "image" ? "image" : "file";

  if (!allowedTypes(kind).includes(file.type)) {
    throw new UploadError(
      uploadFailed("That file type is not supported.", TYPE_FIX[kind]),
    );
  }
  if (file.size > maxBytesForKind(kind)) {
    const maxMb = Math.round(maxBytesForKind(kind) / 1024 / 1024);
    throw new UploadError(
      uploadFailed(
        `That ${noun} is too large.`,
        `Use a ${noun} under ${maxMb} MB. Compress or resize it, then try again.`,
      ),
    );
  }

  let presignResponse: Response;
  try {
    presignResponse = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    });
  } catch {
    throw new UploadError(
      uploadFailed(
        "Could not reach the server to start the upload.",
        "Check your internet connection and try again.",
      ),
    );
  }
  if (!presignResponse.ok) {
    const body = (await presignResponse.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new UploadError(
      uploadFailed(
        body?.error ?? "Could not prepare the upload.",
        presignFix(presignResponse.status),
      ),
    );
  }

  const { url, key } = (await presignResponse.json()) as {
    url: string;
    key: string;
  };

  // Content-Type is part of the presigned signature; it must match exactly.
  let putResponse: Response;
  try {
    putResponse = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
  } catch {
    throw new UploadError(
      uploadFailed(
        "The upload never reached storage: the browser blocked it or the connection dropped.",
        "Check your internet connection and try again. If every upload fails this way, storage isn't set up for this site yet; contact the site owner.",
      ),
    );
  }
  if (!putResponse.ok) {
    throw new UploadError(
      uploadFailed(
        "The upload failed partway through.",
        "Check your connection and try the same file again.",
      ),
    );
  }

  return key;
}
