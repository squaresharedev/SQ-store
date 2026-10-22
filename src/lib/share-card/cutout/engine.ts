import { analyzeCutout, type CutoutBox, type CutoutEdge, type SubjectColour } from "./analyze";
import { maskConfidence, sharpenMask } from "./refine";

/**
 * BACKGROUND REMOVAL, in the browser. BROWSER ONLY: import this from client
 * code, never from a server module.
 *
 * Nothing here can run on the server: the app is a Cloudflare Worker, which
 * runs no model at all. So the seller's own device does it, once per photo
 * (cache.ts keeps the result).
 *
 * THE MODEL is ormbg (Apache 2.0), unquantised, run by transformers.js:
 * half precision on the GPU (WebGPU), full precision on the CPU where there
 * is no usable GPU. What was tried, on the sample storefront's photos
 * (2026-10-20):
 *   - BiRefNet-lite (MIT) cut the cleanest edges of all, in Node, but does
 *     not run in a browser today: the ONNX runtime's WebGPU kernels exceed
 *     the device limits on one of its layers, and on the CPU it runs out of
 *     WebAssembly memory. It is the model to use from a server.
 *   - ormbg quantised to 8 bits turned a white mouse see-through; unquantised
 *     it holds, and sharpenMask (refine.ts) clears the faint haze it leaves.
 *   - RMBG, the usual default, is not licensed for commercial use.
 *
 * The runtime is loaded from a pinned URL at run time rather than installed:
 * its Node build drags native modules (onnxruntime-node, sharp) toward the
 * Worker bundle and the pnpm build allowlist. A DEV-STAGE choice: before this
 * reaches sellers the runtime, its WebAssembly and the model weights should
 * be served from our own origin (R2), and the CSP (next.config.ts, still
 * report-only) should name them. The better production answer is a server
 * cut (Cloudflare Images' `segment=foreground`, BiRefNet) behind the same
 * Cutout shape.
 */

/** transformers.js, pinned: a new runtime never changes a card under us. */
export const CUTOUT_RUNTIME_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";

/** The background-removal model (see above). */
export const CUTOUT_MODEL = "onnx-community/ormbg-ONNX";

/** The longest side a cutout keeps: a little over the 1080 a card exports at. */
const CUTOUT_MAX_SIDE = 1200;

/** A product photo with its background gone, cropped to the product. */
export type Cutout = {
  /** A transparent PNG of the product alone (an object URL). */
  src: string;
  width: number;
  height: number;
  /** Edges of the ORIGINAL photo the product ran off: it was cropped there. */
  bleeds: Record<CutoutEdge, boolean>;
  /** The share of the original photo the product covered, 0..1. */
  coverage: number;
  colour: SubjectColour | null;
  /** How sure the model was of where the product ends, 0..1 (refine.ts). */
  confidence: number;
  /** The original photo's size and where the product was in it, in the
   *  photo's own pixels: a template can lay the cutout exactly over the
   *  photo (the pop-out frame does). */
  source: { width: number; height: number; box: CutoutBox };
};

export type CutoutDevice = "webgpu" | "wasm";

/** What the engine is doing, for a progress line. */
export type CutoutEngineState =
  | { phase: "idle" }
  | { phase: "loading"; loaded: number; total: number; device: CutoutDevice }
  | { phase: "ready"; device: CutoutDevice }
  | { phase: "failed"; message: string };

/** The slice of transformers.js this file uses (it is loaded untyped). A
 *  single image in gives a single image out in v4 (an array in v3). */
type RemovedImage = { data: Uint8ClampedArray; width: number; height: number; channels: number };
type Remover = (input: string) => Promise<RemovedImage | RemovedImage[]>;
type ProgressEvent = { status: string; file?: string; loaded?: number; total?: number };
type Runtime = {
  pipeline: (
    task: "background-removal",
    model: string,
    options: { device: CutoutDevice; dtype: "fp16" | "fp32"; progress_callback: (event: ProgressEvent) => void },
  ) => Promise<Remover>;
};

type GpuNavigator = Navigator & {
  gpu?: { requestAdapter(): Promise<{ requestDevice(): Promise<{ destroy(): void }> } | null> };
};

/** WebGPU where a device can actually be MADE: a browser can offer an
 *  adapter and still fail to open it (a missing shader compiler on Windows
 *  does exactly that), so asking for the adapter alone is not enough. */
async function gpuWorks(): Promise<boolean> {
  const gpu = (navigator as GpuNavigator).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return false;
    (await adapter.requestDevice()).destroy();
    return true;
  } catch {
    return false;
  }
}

type Loaded = { remove: Remover; device: CutoutDevice };

let runtime: Promise<Runtime> | null = null;
let loaded: Promise<Loaded> | null = null;

function loadOn(device: CutoutDevice, onState: (state: CutoutEngineState) => void): Promise<Loaded> {
  runtime ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ CUTOUT_RUNTIME_URL) as Promise<Runtime>;
  const files = new Map<string, { loaded: number; total: number }>();
  onState({ phase: "loading", loaded: 0, total: 0, device });
  return runtime.then(async (rt) => {
    const remove = await rt.pipeline("background-removal", CUTOUT_MODEL, {
      device,
      // Half precision halves the download, and only a GPU runs it well.
      dtype: device === "webgpu" ? "fp16" : "fp32",
      progress_callback: (event) => {
        if (event.status !== "progress" || !event.file) return;
        files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
        let sum = 0;
        let total = 0;
        for (const file of files.values()) {
          sum += file.loaded;
          total += file.total;
        }
        onState({ phase: "loading", loaded: sum, total, device });
      },
    });
    onState({ phase: "ready", device });
    return { remove, device };
  });
}

/** The model, loaded once: on the GPU when one works, else the CPU. A failed
 *  load is forgotten, so the next request tries again. */
function load(onState: (state: CutoutEngineState) => void): Promise<Loaded> {
  loaded ??= gpuWorks().then((gpu) =>
    gpu ? loadOn("webgpu", onState).catch(() => loadOn("wasm", onState)) : loadOn("wasm", onState),
  );
  loaded.catch((error: unknown) => {
    loaded = null;
    onState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
  });
  return loaded;
}

/** Run the model on `src`; a GPU that loads the model but fails to RUN it
 *  hands over to the CPU, once, for this and every later photo. */
async function remove(src: string, onState: (state: CutoutEngineState) => void): Promise<RemovedImage> {
  const engine = await load(onState);
  try {
    const out = await engine.remove(src);
    return Array.isArray(out) ? out[0] : out;
  } catch (error) {
    if (engine.device === "wasm") throw error;
    loaded = loadOn("wasm", onState);
    const out = await (await loaded).remove(src);
    return Array.isArray(out) ? out[0] : out;
  }
}

/** Cutouts run one at a time: two at once only share the same GPU or CPU. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Cut the product out of the photo at `src` (same origin, or served with
 * CORS: the pixels have to be readable). Rejects when the model finds no
 * product at all.
 */
export function cutOut(src: string, onState: (state: CutoutEngineState) => void): Promise<{ cutout: Cutout; png: Blob }> {
  const job = queue.then(async () => {
    const image = await remove(src, onState);
    if (!image || image.channels !== 4) throw new Error("The model returned no mask.");
    const rgba = new Uint8ClampedArray(image.data);
    const confidence = maskConfidence(rgba);
    sharpenMask(rgba);
    const analysis = analyzeCutout(rgba, image.width, image.height);
    if (!analysis.box) throw new Error("No product found in the photo.");

    const full = document.createElement("canvas");
    full.width = image.width;
    full.height = image.height;
    full.getContext("2d")!.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);

    const { x, y, width, height } = analysis.box;
    const scale = Math.min(1, CUTOUT_MAX_SIDE / Math.max(width, height));
    const out = document.createElement("canvas");
    out.width = Math.round(width * scale);
    out.height = Math.round(height * scale);
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, x, y, width, height, 0, 0, out.width, out.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the cutout."))), "image/png"),
    );
    return {
      png,
      cutout: {
        src: URL.createObjectURL(png),
        width: out.width,
        height: out.height,
        bleeds: analysis.bleeds,
        coverage: analysis.coverage,
        colour: analysis.colour,
        confidence,
        source: { width: image.width, height: image.height, box: analysis.box },
      },
    };
  });
  queue = job.catch(() => undefined);
  return job;
}
