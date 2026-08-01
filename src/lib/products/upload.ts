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

/** Outcome of the PUT, distinguishing "never left the browser" from "storage
 *  said no" so each keeps its own message + fix. */
type PutOutcome = { reached: true; ok: boolean } | { reached: false };

/**
 * PUT the file with upload progress. XHR rather than fetch: `fetch` gives no
 * way to observe request-body progress, so a large file would sit on an
 * indeterminate spinner with no sign of life.
 *
 * `onProgress` receives 0..1, and only while the total is known
 * (`lengthComputable`); callers fall back to an indeterminate bar otherwise.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<PutOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Content-Type is part of the presigned signature; it must match exactly.
    xhr.setRequestHeader("Content-Type", file.type);

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(1, event.loaded / event.total));
        }
      };
    }

    // A 4xx/5xx still counts as "reached storage"; only transport failures
    // (blocked request, dropped connection, abort) do not.
    xhr.onload = () => resolve({ reached: true, ok: xhr.status >= 200 && xhr.status < 300 });
    xhr.onerror = () => resolve({ reached: false });
    xhr.ontimeout = () => resolve({ reached: false });
    xhr.onabort = () => resolve({ reached: false });

    xhr.send(file);
  });
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
export async function uploadToR2(
  file: File,
  kind: UploadKind,
  /** Called with 0..1 as the body uploads, when the total size is known. */
  onProgress?: (fraction: number) => void,
): Promise<string> {
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

  const outcome = await putWithProgress(url, file, onProgress);
  if (!outcome.reached) {
    throw new UploadError(
      uploadFailed(
        "The upload never reached storage: the browser blocked it or the connection dropped.",
        "Check your internet connection and try again. If every upload fails this way, storage isn't set up for this site yet; contact the site owner.",
      ),
    );
  }
  if (!outcome.ok) {
    throw new UploadError(
      uploadFailed(
        "The upload failed partway through.",
        "Check your connection and try the same file again.",
      ),
    );
  }

  return key;
}
