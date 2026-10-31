import { z } from "zod";
import { FETCH_USER_AGENT, isPublicHttpsUrl } from "@/lib/agent/oauth/public-url";

/**
 * How a picture reaches a tool: a URL this server fetches, or the bytes inline.
 * Inline is bounded by /mcp's request size, so anything big has to be a URL.
 */
export const imageInputShape = {
  url: z.string().max(2000).optional().describe("A public HTTPS link to the image."),
  base64: z
    .string()
    .max(4_000_000)
    .optional()
    .describe("The image's bytes, base64 encoded. About 3 MB at most: use url for anything larger."),
  filename: z.string().max(200).optional().describe("A name for the file. Optional."),
};

export type ImageInput = { url?: string; base64?: string; filename?: string };

const FETCH_TIMEOUT_MS = 15_000;
const REDIRECTS_MAX = 3;

/** Read a response body up to `maxBytes`, stopping as soon as it goes past. */
async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetch a picture from a URL an assistant named. Each hop of a redirect is
 * judged again, because a public URL can redirect anywhere.
 */
async function fetchImage(startUrl: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  let url = startUrl;
  for (let hop = 0; hop <= REDIRECTS_MAX; hop += 1) {
    if (!isPublicHttpsUrl(url)) return null;
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": FETCH_USER_AGENT },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      url = new URL(next, url).toString();
      continue;
    }
    return response.ok ? readBounded(response, maxBytes) : null;
  }
  return null;
}

function decodeBase64(text: string, maxBytes: number): Uint8Array<ArrayBuffer> | null {
  const body = text.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return null;
  let binary: string;
  try {
    binary = atob(body);
  } catch {
    return null;
  }
  if (binary.length === 0 || binary.length > maxBytes) return null;
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The picture's bytes, or null when it could not be read within `maxBytes`.
 *  What the bytes ARE is judged by whoever stores them (lib/uploads/sniff). */
export async function bytesFromImageInput(
  input: ImageInput,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    if (input.base64) return decodeBase64(input.base64, maxBytes);
    if (input.url) return await fetchImage(input.url, maxBytes);
  } catch (error) {
    console.warn("[agent] reading an image failed:", error instanceof Error ? error.message : String(error));
  }
  return null;
}

export async function fileFromImageInput(input: ImageInput, maxBytes: number): Promise<File | null> {
  const bytes = await bytesFromImageInput(input, maxBytes);
  if (!bytes) return null;
  return new File([bytes], input.filename || "image");
}
