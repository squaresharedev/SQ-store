import {
  DIGITAL_FILE_CONTENT_TYPES,
  ELEMENT_CONTENT_TYPES,
  FONT_CONTENT_TYPES,
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
  font: "Use a WOFF2, WOFF, TTF, or OTF font file.",
  element: "Use an SVG, PNG, WebP, JPEG, GIF, or AVIF image.",
};

/** What each kind is CALLED in the messages a seller reads. */
const UPLOAD_NOUN: Record<UploadKind, string> = {
  image: "image",
  file: "file",
  font: "font",
  element: "element",
};

function allowedTypes(kind: UploadKind): readonly string[] {
  switch (kind) {
    case "image":
      return IMAGE_CONTENT_TYPES;
    case "font":
      return FONT_CONTENT_TYPES;
    case "element":
      return ELEMENT_CONTENT_TYPES;
    case "file":
      return DIGITAL_FILE_CONTENT_TYPES;
  }
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
 * Send a request body with upload progress. XHR rather than fetch: `fetch`
 * gives no way to observe request-body progress, so a large file would sit on
 * an indeterminate spinner with no sign of life.
 *
 * `onProgress` receives 0..1 while bytes are moving and the total is known
 * (`lengthComputable`), then NULL once the body is fully sent and we are
 * waiting on the far end. That second phase is real work — for an image the
 * server still has to sniff, moderate and PUT it to R2 — and without the
 * signal the bar parks at 100%% and looks hung.
 */
function sendWithProgress(
  method: "PUT" | "POST",
  url: string,
  body: File | FormData,
  onProgress?: (fraction: number | null) => void,
  /** Only for the presigned PUT, whose signature covers Content-Type. A
   *  multipart POST must let the browser set its own boundary header. */
  contentType?: string,
): Promise<PutOutcome & { status: number; text: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);

    if (onProgress) {
      // Body fully sent; everything after this is the far end working.
      xhr.upload.onload = () => onProgress(null);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(1, event.loaded / event.total));
        }
      };
    }

    // A 4xx/5xx still counts as "reached the server"; only transport failures
    // (blocked request, dropped connection, abort) do not.
    xhr.onload = () =>
      resolve({
        reached: true,
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: xhr.responseText,
      });
    const dead = () => resolve({ reached: false, status: 0, text: "" });
    xhr.onerror = dead;
    xhr.ontimeout = dead;
    xhr.onabort = dead;

    xhr.send(body);
  });
}

/**
 * Upload an image THROUGH our own server (same origin), which stores it in R2
 * after sniffing its real type and running it past moderation.
 *
 * Deliberately not a presigned browser PUT to R2: that is cross-origin, so it
 * depends on the bucket's CORS allowlist naming every origin the app is served
 * from. Ours named only http://localhost:3000, so uploads failed at preflight
 * everywhere else and no image ever reached the database. Same-origin has no
 * preflight to get wrong.
 */
/** Read a { key } | { error, fix } response from one of our upload routes. */
function keyFromResponse(
  outcome: PutOutcome & { status: number; text: string },
  noun: string,
): string {
  if (!outcome.reached) {
    throw new UploadError(
      uploadFailed(
        `The ${noun} never reached the server.`,
        "Check your internet connection and try again.",
      ),
    );
  }
  const payload = (() => {
    try {
      return JSON.parse(outcome.text) as { key?: string; error?: string; fix?: string };
    } catch {
      return null;
    }
  })();
  // A 2xx WITHOUT a key means the server took the file but it is not usable —
  // today that is "held for review" (202). Treating it as success would
  // attach a key that does not exist.
  if (!outcome.ok || !payload?.key) {
    throw new UploadError(
      uploadFailed(
        payload?.error ?? `Could not upload that ${noun}.`,
        payload?.fix ?? presignFix(outcome.status),
      ),
    );
  }
  return payload.key;
}

/**
 * Stream a digital file THROUGH our server. The body is the file itself (not
 * multipart) so the server can pipe it straight into storage without ever
 * holding 200 MB in memory; the filename and type ride in the query string.
 */
async function uploadFileViaServer(
  file: File,
  onProgress?: (fraction: number | null) => void,
): Promise<string> {
  const query = new URLSearchParams({
    filename: file.name,
    contentType: file.type,
  });
  const outcome = await sendWithProgress(
    "POST",
    `/api/uploads/file?${query}`,
    file,
    onProgress,
    file.type,
  );
  return keyFromResponse(outcome, "file");
}

/** Multipart POST to one of our own upload routes, under the field name that
 *  route accepts. Shared by images and fonts, which differ only in those two. */
async function uploadFormViaServer(
  file: File,
  route: string,
  field: string,
  onProgress?: (fraction: number | null) => void,
): Promise<string> {
  const body = new FormData();
  body.append(field, file);

  const outcome = await sendWithProgress("POST", route, body, onProgress);
  return keyFromResponse(outcome, field);
}

/** Font extensions, checked instead of `file.type`: browsers report font MIME
 *  types inconsistently (often an empty string), so trusting the claim here
 *  would refuse perfectly good uploads before they ever reached the sniffer. */
const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"];

function looksLikeFont(file: File): boolean {
  const name = file.name.toLowerCase();
  return FONT_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Elements accept SVG, and browsers are inconsistent about its MIME type —
 * some report `image/svg+xml`, some an empty string, some `text/xml`. Judging
 * the extension too keeps a perfectly good logo from being refused here,
 * before the server ever gets to read the bytes.
 *
 * This is a UX pre-check ONLY. `sniffSvg` on the server decides what the file
 * really is, and a `.svg` name proves nothing to it.
 */
function looksLikeElement(file: File): boolean {
  if (allowedTypes("element").includes(file.type)) return true;
  return file.name.toLowerCase().endsWith(".svg");
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
  onProgress?: (fraction: number | null) => void,
): Promise<string> {
  const noun = UPLOAD_NOUN[kind];

  const typeLooksRight =
    kind === "font"
      ? looksLikeFont(file)
      : kind === "element"
        ? looksLikeElement(file)
        : allowedTypes(kind).includes(file.type);
  if (!typeLooksRight) {
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

  // EVERY kind goes through our own server, same origin. Nothing touches R2
  // directly any more: a cross-origin PUT depends on the bucket's CORS
  // allowlist naming every origin the app is served from, which silently
  // broke uploads on every dev port and every deployed domain but one.
  switch (kind) {
    case "image":
      return uploadFormViaServer(file, "/api/uploads/image", "image", onProgress);
    case "font":
      return uploadFormViaServer(file, "/api/uploads/font", "font", onProgress);
    case "element":
      return uploadFormViaServer(file, "/api/uploads/element", "element", onProgress);
    case "file":
      return uploadFileViaServer(file, onProgress);
  }
}
