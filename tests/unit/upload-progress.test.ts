// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadToR2, UploadError } from "@/lib/products/upload";

/**
 * `uploadToR2` now takes two different routes, and the difference is the point:
 *
 *   IMAGES -> POST /api/uploads/image (SAME ORIGIN). The server holds the
 *     bytes, sniffs them, moderates them and does the PUT itself. Images used
 *     to take the presigned path below, which is cross-origin and so depends
 *     on the bucket's CORS allowlist naming every origin the app is served
 *     from — ours named one, so uploads failed everywhere else and no product
 *     image ever reached the database.
 *
 *   FILES -> presign + direct PUT to R2, because a 200 MB body cannot be
 *     buffered through a Worker.
 *
 * Both use XHR so byte progress is observable. These cover what that has to
 * preserve: progress reporting, and keeping a transport failure a DIFFERENT
 * error from a server/bucket rejection, since the fixes differ.
 */

type FakeXhrOptions = {
  /** Status to report on load; omit to simulate a transport failure. */
  status?: number;
  /** Body to return, for routes that answer with JSON. */
  responseText?: string;
  /** Byte checkpoints to emit as upload progress before completing. */
  progress?: { loaded: number; total: number; lengthComputable?: boolean }[];
};

let xhrOptions: FakeXhrOptions = { status: 200 };
const sent: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}[] = [];

class FakeXhr {
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload: {
    onprogress: ((e: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  private method = "";
  private url = "";
  private headers: Record<string, string> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    sent.push({ method: this.method, url: this.url, headers: this.headers, body });
    // Deliver asynchronously, as a real request would.
    queueMicrotask(() => {
      for (const tick of xhrOptions.progress ?? []) {
        this.upload.onprogress?.({
          lengthComputable: tick.lengthComputable ?? true,
          loaded: tick.loaded,
          total: tick.total,
        } as ProgressEvent);
      }
      if (xhrOptions.status === undefined) {
        this.onerror?.();
        return;
      }
      // The body is now fully sent; everything after is the far end working.
      this.upload.onload?.();
      this.status = xhrOptions.status;
      this.responseText = xhrOptions.responseText ?? "";
      this.onload?.();
    });
  }
}

const IMAGE_KEY = "images/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/photo.png";
const FILE_KEY = "files/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/bundle.zip";

/** A PNG comfortably under the image cap. */
const imageFile = () => new File([new Uint8Array(64)], "a.png", { type: "image/png" });
const zipFile = () => new File([new Uint8Array(64)], "b.zip", { type: "application/zip" });

/** Both upload routes answer with JSON; the default is a successful store. */
function routeReturns(status: number, body: unknown) {
  xhrOptions = { status, responseText: JSON.stringify(body) };
}

/** Nothing should call fetch any more; stubbed so "not called" is meaningful. */
function mockPresignOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ url: "https://r2.test/put", key: FILE_KEY }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

beforeEach(() => {
  sent.length = 0;
  routeReturns(200, { key: IMAGE_KEY });
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  mockPresignOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadToR2 - images go through our own server", () => {
  it("POSTs to the same-origin route and returns the key it mints", async () => {
    const key = await uploadToR2(imageFile(), "image");
    expect(key).toBe(IMAGE_KEY);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("POST");
    // Same-origin path, so there is no CORS preflight to be blocked by.
    expect(sent[0].url).toBe("/api/uploads/image");
    expect(sent[0].body).toBeInstanceOf(FormData);
  });

  it("never contacts R2 directly for an image", async () => {
    // The presign endpoint refuses images; going near it would be a bug.
    await uploadToR2(imageFile(), "image");
    expect(fetch).not.toHaveBeenCalled();
    expect(sent.every((r) => r.url.startsWith("/api/"))).toBe(true);
  });

  it("lets the browser set Content-Type, so the multipart boundary is right", async () => {
    await uploadToR2(imageFile(), "image");
    expect(sent[0].headers["Content-Type"]).toBeUndefined();
  });

  it("reports fractional progress as bytes move", async () => {
    xhrOptions = {
      status: 200,
      responseText: JSON.stringify({ key: IMAGE_KEY }),
      progress: [
        { loaded: 25, total: 100 },
        { loaded: 100, total: 100 },
      ],
    };
    const seen: (number | null)[] = [];
    await uploadToR2(imageFile(), "image", (f) => seen.push(f));
    // …then null: sent, waiting on the server.
    expect(seen).toEqual([0.25, 1, null]);
  });

  it("ignores progress events with an unknown total", async () => {
    xhrOptions = {
      status: 200,
      responseText: JSON.stringify({ key: IMAGE_KEY }),
      progress: [{ loaded: 10, total: 0, lengthComputable: false }],
    };
    const seen: (number | null)[] = [];
    await uploadToR2(imageFile(), "image", (f) => seen.push(f));
    expect(seen).toEqual([null]);
  });

  it("surfaces the server's own reason when it refuses the image", async () => {
    // e.g. moderation rejected it — the uploader deserves that sentence, not
    // a generic failure.
    routeReturns(422, { error: "That image breaks the content rules.", fix: "Pick another." });
    await expect(uploadToR2(imageFile(), "image")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UploadError &&
        error.info.message === "That image breaks the content rules.",
    );
  });

  it("treats a 2xx WITHOUT a key as not-usable, not success", async () => {
    // 202 = accepted but held for review. Returning success here would attach
    // a key that does not exist to the product.
    routeReturns(202, { error: "That image is being checked before it goes live." });
    await expect(uploadToR2(imageFile(), "image")).rejects.toBeInstanceOf(UploadError);
  });

  it("distinguishes a transport failure from a server rejection", async () => {
    xhrOptions = { status: undefined };
    await expect(uploadToR2(imageFile(), "image")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UploadError && /never reached the server/i.test(error.info.message),
    );
  });

  it("rejects an oversized image before opening a request", async () => {
    const huge = new File([new Uint8Array(2)], "big.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 999 * 1024 * 1024 });
    await expect(uploadToR2(huge, "image")).rejects.toBeInstanceOf(UploadError);
    expect(sent).toHaveLength(0);
  });
});

describe("uploadToR2 - digital files stream through our server too", () => {
  it("POSTs the file itself to the file route, with metadata in the query", async () => {
    routeReturns(200, { key: FILE_KEY });
    const key = await uploadToR2(zipFile(), "file");
    expect(key).toBe(FILE_KEY);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("POST");
    // The body is the FILE, not multipart: the server pipes it straight
    // into storage rather than buffering 200 MB to parse a form.
    expect(sent[0].body).toBeInstanceOf(File);
    const [path, query] = sent[0].url.split("?");
    expect(path).toBe("/api/uploads/file");
    const params = new URLSearchParams(query);
    expect(params.get("filename")).toBe("b.zip");
    expect(params.get("contentType")).toBe("application/zip");
  });

  it("never contacts R2 directly, so no CORS allowlist is involved", async () => {
    // The bug this replaced: a cross-origin PUT died at preflight on every
    // origin the bucket did not name, which was all but one.
    routeReturns(200, { key: FILE_KEY });
    await uploadToR2(zipFile(), "file");
    expect(sent.every((r) => r.url.startsWith("/api/"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces the server reason when the file is refused", async () => {
    routeReturns(415, { error: "That file type is not supported." });
    await expect(uploadToR2(zipFile(), "file")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UploadError &&
        error.info.message === "That file type is not supported.",
    );
  });

  it("distinguishes a dropped connection from a server rejection", async () => {
    xhrOptions = { status: undefined };
    await expect(uploadToR2(zipFile(), "file")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UploadError && /never reached the server/i.test(error.info.message),
    );
  });
});
