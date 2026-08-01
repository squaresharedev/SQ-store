// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadToR2, UploadError } from "@/lib/products/upload";

// The PUT moved from fetch to XHR so upload progress can be observed. These
// cover the contract that swap has to preserve: a transport failure and a
// rejecting bucket must stay DIFFERENT errors, because their fixes differ.

type FakeXhrOptions = {
  /** Status to report on load; omit to simulate a transport failure. */
  status?: number;
  /** Byte checkpoints to emit as upload progress before completing. */
  progress?: { loaded: number; total: number; lengthComputable?: boolean }[];
};

let xhrOptions: FakeXhrOptions = { status: 200 };
const sent: { url: string; headers: Record<string, string> }[] = [];

class FakeXhr {
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  private url = "";
  private headers: Record<string, string> = {};

  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    sent.push({ url: this.url, headers: this.headers });
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
      this.status = xhrOptions.status;
      this.onload?.();
    });
  }
}

/** A PNG comfortably under the image cap. */
function imageFile() {
  return new File([new Uint8Array(64)], "a.png", { type: "image/png" });
}

function mockPresignOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ url: "https://r2.test/put", key: "images/u/a.png" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

beforeEach(() => {
  sent.length = 0;
  xhrOptions = { status: 200 };
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  mockPresignOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadToR2 progress", () => {
  it("returns the key and sends the signed content type", async () => {
    const key = await uploadToR2(imageFile(), "image");
    expect(key).toBe("images/u/a.png");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://r2.test/put");
    // Content-Type is part of the presigned signature; it must match exactly.
    expect(sent[0].headers["Content-Type"]).toBe("image/png");
  });

  it("reports fractional progress as bytes move", async () => {
    xhrOptions = {
      status: 200,
      progress: [
        { loaded: 25, total: 100 },
        { loaded: 100, total: 100 },
      ],
    };
    const seen: number[] = [];
    await uploadToR2(imageFile(), "image", (f) => seen.push(f));
    expect(seen).toEqual([0.25, 1]);
  });

  it("ignores progress events with an unknown total", async () => {
    xhrOptions = {
      status: 200,
      progress: [{ loaded: 10, total: 0, lengthComputable: false }],
    };
    const seen: number[] = [];
    await uploadToR2(imageFile(), "image", (f) => seen.push(f));
    expect(seen).toEqual([]);
  });

  it("distinguishes a transport failure from a rejected upload", async () => {
    xhrOptions = { status: undefined };
    await expect(uploadToR2(imageFile(), "image")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UploadError && /never reached storage/i.test(error.info.message),
    );

    xhrOptions = { status: 403 };
    await expect(uploadToR2(imageFile(), "image")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UploadError && /failed partway/i.test(error.info.message),
    );
  });

  it("rejects an oversized file before opening a request", async () => {
    const huge = new File([new Uint8Array(2)], "big.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 999 * 1024 * 1024 });

    await expect(uploadToR2(huge, "image")).rejects.toBeInstanceOf(UploadError);
    expect(sent).toHaveLength(0);
  });
});
