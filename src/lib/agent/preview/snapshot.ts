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

/** The two screens a preview is taken at: a laptop, and a common phone. */
export const PREVIEW_VIEWPORTS: Record<PreviewViewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

/** Set on <html> by the preview page once every tile is measured. */
export const PREVIEW_READY_SELECTOR = "html[data-preview-ready]";

export type Snapshot = { image: string; mimeType: "image/jpeg"; html: string };

/** The page, taken full length as a JPEG (a fraction of a PNG's size). */
function snapshotRequest(url: string, viewport: PreviewViewport) {
  return {
    url,
    viewport: PREVIEW_VIEWPORTS[viewport],
    gotoOptions: { waitUntil: "load", timeout: 20_000 },
    waitForSelector: { selector: PREVIEW_READY_SELECTOR, timeout: 15_000 },
    screenshotOptions: { fullPage: true, type: "jpeg", quality: 80 },
  };
}

type BrowserBinding = { quickAction: (action: "snapshot", options: unknown) => Promise<Response> };

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

export async function takeSnapshot(url: string, viewport: PreviewViewport): Promise<Snapshot | null> {
  const request = snapshotRequest(url, viewport);
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
