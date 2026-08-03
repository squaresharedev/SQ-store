// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sniffImage } from "@/lib/uploads/sniff";

/**
 * The magic-byte sniffer decides what an upload IS. A client's declared
 * Content-Type and filename are both claims it fully controls, so if this is
 * wrong the type checks above it are decoration.
 */

/** Pad a signature out past the 12-byte minimum with harmless filler. */
function withSignature(...head: number[]): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(head, 0);
  return bytes;
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const JPEG = withSignature(0xff, 0xd8, 0xff, 0xe0);
const PNG = withSignature(0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a);
const GIF87 = withSignature(...ascii("GIF87a"));
const GIF89 = withSignature(...ascii("GIF89a"));
const WEBP = withSignature(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"));
const AVIF = withSignature(0, 0, 0, 0x20, ...ascii("ftyp"), ...ascii("avif"));
const AVIS = withSignature(0, 0, 0, 0x20, ...ascii("ftyp"), ...ascii("avis"));

describe("sniffImage - recognises every supported format", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg", "jpg"],
    ["PNG", PNG, "image/png", "png"],
    ["GIF87a", GIF87, "image/gif", "gif"],
    ["GIF89a", GIF89, "image/gif", "gif"],
    ["WebP", WEBP, "image/webp", "webp"],
    ["AVIF", AVIF, "image/avif", "avif"],
    ["AVIF sequence", AVIS, "image/avif", "avif"],
  ])("identifies %s", (_label, bytes, mime, ext) => {
    expect(sniffImage(bytes as Uint8Array)).toEqual({ mime, ext });
  });
});

describe("sniffImage - refuses everything else", () => {
  it("rejects a script that merely claims to be an image", () => {
    // The whole point: this would sail through a filename/Content-Type check.
    const script = new TextEncoder().encode("<script>alert(1)</script>       ");
    expect(sniffImage(script)).toBeNull();
  });

  it("rejects a PDF", () => {
    expect(sniffImage(withSignature(...ascii("%PDF-1.7")))).toBeNull();
  });

  it("rejects a ZIP (and so an unpacked archive renamed .png)", () => {
    expect(sniffImage(withSignature(0x50, 0x4b, 0x03, 0x04))).toBeNull();
  });

  it("rejects an SVG — it is markup, and markup is a script vector", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='...'></svg>"))).toBeNull();
  });

  it("rejects a RIFF container that is not WebP (e.g. a WAV)", () => {
    const wav = withSignature(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE"));
    expect(sniffImage(wav)).toBeNull();
  });

  it("rejects an ISO-BMFF container that is not AVIF (e.g. an MP4)", () => {
    const mp4 = withSignature(0, 0, 0, 0x20, ...ascii("ftyp"), ...ascii("isom"));
    expect(sniffImage(mp4)).toBeNull();
  });

  it("rejects a truncated file rather than guessing from a partial header", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it("rejects a valid signature that does not start at byte 0", () => {
    // A polyglot with PNG magic buried inside is not a PNG to any decoder.
    const offset = new Uint8Array(32);
    offset.set([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a], 4);
    expect(sniffImage(offset)).toBeNull();
  });
});
