import { PREVIEW_REGION_ELEMENT_ID } from "@/lib/agent/preview/targets";

/**
 * A PICTURE OF A PAGE, AS A BROWSER DRAWS IT, so a preview shows the real
 * renderer and the model can see what it built.
 *
 * Production asks Cloudflare Browser Run through the Worker's BROWSER binding
 * (`quickAction("snapshot")`: no API token, nothing bundled). The snapshot is the
 * screenshot AND the rendered HTML in one browser session; the HTML carries
 * where each product tile landed (components/agent/PreviewProbe), which the
 * preview's view turns into click targets.
 *
 * The e2e stack has no Browser Run, so in development only, when
 * AGENT_PREVIEW_TEST_SNAPSHOT_URL is set, the stack's own headless browser
 * answers the same request (tests/e2e/stack/server.mjs). A production build
 * never reads that variable.
 *
 * Every failure is null: a preview without a picture still answers in words.
 */

export type PreviewViewport = "desktop" | "mobile";

/**
 * How sharp a picture is. `standard` photographs a wide page smaller (the
 * desktop at 800 pixels for its 1280), which keeps a long page within what a
 * result can carry; `full` photographs it at one picture pixel per page pixel.
 */
export type PreviewResolution = "standard" | "full";

/** The two screens a preview is taken at: a laptop, and a common phone. */
export const PREVIEW_VIEWPORTS: Record<PreviewViewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

/**
 * How wide each picture is at standard resolution, in pixels. A page is laid
 * out at its screen's own width and photographed smaller where that is wide: a
 * full-length desktop page at 1280 pixels is past what a chat host hands a
 * model, so it never reached it.
 */
export const PREVIEW_PICTURE_WIDTH_PX: Record<PreviewViewport, number> = { desktop: 800, mobile: 390 };

/** Picture pixels per page pixel: what a measurement on the page is times, on its picture. */
export function pictureScale(viewport: PreviewViewport, resolution: PreviewResolution = "standard"): number {
  return resolution === "full" ? 1 : PREVIEW_PICTURE_WIDTH_PX[viewport] / PREVIEW_VIEWPORTS[viewport].width;
}

/** Set on <html> by the preview page once every tile is measured. */
export const PREVIEW_READY_SELECTOR = "html[data-preview-ready]";

export type Snapshot = { image: string; mimeType: "image/jpeg"; html: string };

/**
 * JPEG quality. Kept low enough that both pictures and the words fit well
 * inside what a chat host will hand to an MCP Apps view (Claude: about 150,000
 * characters per tool result, docs/mcp-apps.md); legible text still survives.
 */
const SNAPSHOT_JPEG_QUALITY = 60;

/** What to photograph beyond the page itself. */
export type SnapshotOptions = {
  resolution?: PreviewResolution;
  /** Crop to the region the page drew its marker over (PREVIEW_REGION_ELEMENT_ID),
   *  at full resolution. The page must have been opened with that region. */
  region?: boolean;
};

/**
 * The request a snapshot is taken with. The whole page, full length, as a JPEG
 * (a fraction of a PNG's size), drawn at the device scale its resolution asks
 * for; or, for a region, only the box of the marker the page laid over it,
 * which the browser crops to by selector, at full resolution.
 */
export function snapshotRequest(url: string, viewport: PreviewViewport, options: SnapshotOptions = {}) {
  const region = options.region === true;
  const jpeg = { type: "jpeg", quality: SNAPSHOT_JPEG_QUALITY } as const;
  return {
    url,
    viewport: { ...PREVIEW_VIEWPORTS[viewport], deviceScaleFactor: region ? 1 : pictureScale(viewport, options.resolution) },
    gotoOptions: { waitUntil: "load", timeout: 20_000 },
    waitForSelector: { selector: PREVIEW_READY_SELECTOR, timeout: 15_000 },
    ...(region ? { selector: `#${PREVIEW_REGION_ELEMENT_ID}` } : {}),
    screenshotOptions: region ? jpeg : { fullPage: true, ...jpeg },
  };
}

/** The base64 characters that carry a JPEG's first 48 KB: always past its frame header. */
const JPEG_HEAD_CHARS = 65_536;

/**
 * A JPEG's width and height in pixels, read from its frame header (the SOF
 * marker), or null when the bytes are not a JPEG. How a cropped picture is
 * checked to be the crop that was asked for.
 */
export function jpegSize(base64: string): { width: number; height: number } | null {
  let bytes: Uint8Array;
  try {
    const binary = atob(base64.slice(0, JPEG_HEAD_CHARS));
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Start of frame, any kind but the three that are not frames (C4, C8, CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] };
    }
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  return null;
}

/** How far a crop may be off the box it was cut to, in pixels: the browser
 *  rounds a fractional box to whole pixels on each edge. */
const CROP_TOLERANCE_PX = 2;

/**
 * Is this picture the region the page marked (`region`, in page pixels), at
 * one picture pixel per page pixel? A browser that ignored the crop answers
 * with a picture of the screen instead, which must never be passed off as the
 * region.
 */
export function croppedAsAsked(image: string, region: { w: number; h: number } | undefined): boolean {
  const size = jpegSize(image);
  return (
    !!size &&
    !!region &&
    Math.abs(size.width - region.w) <= CROP_TOLERANCE_PX &&
    Math.abs(size.height - region.h) <= CROP_TOLERANCE_PX
  );
}

type BrowserBinding ={ quickAction: (action: "snapshot", options: unknown) => Promise<Response> };

async function browserBinding(): Promise<BrowserBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const binding = (env as Record<string, unknown>).BROWSER as BrowserBinding | undefined;
    return typeof binding?.quickAction === "function" ? binding : null;
  } catch {
    // No Worker around this code (next dev, a script).
    return null;
  }
}

function testSnapshotUrl(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return process.env.AGENT_PREVIEW_TEST_SNAPSHOT_URL || null;
}

/** Whether this deployment can take a picture at all. */
export async function snapshotsAvailable(): Promise<boolean> {
  return Boolean(testSnapshotUrl() || (await browserBinding()));
}

export async function takeSnapshot(
  url: string,
  viewport: PreviewViewport,
  options: SnapshotOptions = {},
): Promise<Snapshot | null> {
  const request = snapshotRequest(url, viewport, options);
  try {
    let response: Response;
    const test = testSnapshotUrl();
    if (test) {
      response = await fetch(test, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    } else {
      const binding = await browserBinding();
      if (!binding) return null;
      response = await binding.quickAction("snapshot", request);
    }
    if (!response.ok) {
      console.warn(`[agent] preview snapshot refused (${viewport}): ${response.status}`);
      return null;
    }
    const body = (await response.json()) as { success?: boolean; result?: { screenshot?: string; content?: string } };
    const image = body.result?.screenshot;
    if (!body.success || !image) return null;
    return { image, mimeType: "image/jpeg", html: body.result?.content ?? "" };
  } catch (error) {
    console.warn(`[agent] preview snapshot failed (${viewport}):`, error instanceof Error ? error.message : String(error));
    return null;
  }
}
