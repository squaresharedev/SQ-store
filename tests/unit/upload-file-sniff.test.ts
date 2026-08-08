// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fileBytesContradictType, sniffFile } from "@/lib/uploads/sniff";
import { peekStream } from "@/lib/uploads/peek";

/**
 * Digital-file uploads used to be typed entirely by a query parameter: the
 * client said `contentType=application/zip` and that string became the stored
 * object's Content-Type with nothing ever checking the bytes. The image route
 * had sniffed its uploads since it was written; this one could not, because it
 * streams a 200 MB body it never holds.
 *
 * These cover the two halves of the fix: reading the container signature, and
 * reading it without eating the stream.
 */

const pad = (head: number[]): Uint8Array =>
  new Uint8Array([...head, ...new Array(Math.max(0, 16 - head.length)).fill(0x41)]);

const ZIP = pad([0x50, 0x4b, 0x03, 0x04]);
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const ID3_MP3 = pad([0x49, 0x44, 0x33, 0x04]);
const BARE_MP3 = pad([0xff, 0xfb, 0x90, 0x00]);
const WAV = pad([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
const MP4 = pad([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const AVIF = pad([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT = new Uint8Array([...Buffer.from("Hello, this is a readme file.\n")]);

describe("sniffFile", () => {
  it("identifies each container family", () => {
    expect(sniffFile(ZIP)).toBe("zip");
    expect(sniffFile(PDF)).toBe("pdf");
    expect(sniffFile(ID3_MP3)).toBe("mpeg-audio");
    expect(sniffFile(BARE_MP3)).toBe("mpeg-audio");
    expect(sniffFile(WAV)).toBe("wav");
    expect(sniffFile(MP4)).toBe("mp4");
    expect(sniffFile(PNG)).toBe("image");
  });

  it("does not mistake an AVIF for video, or a WAV for a WebP", () => {
    // Both are shared-container formats; getting these backwards would reject
    // legitimate uploads rather than admit bad ones, but it would still be wrong.
    expect(sniffFile(AVIF)).toBe("image");
    expect(sniffFile(WAV)).toBe("wav");
  });

  it("returns null for text, which has no signature", () => {
    expect(sniffFile(TEXT)).toBeNull();
  });
});

describe("fileBytesContradictType", () => {
  it("accepts every honest declaration", () => {
    expect(fileBytesContradictType(ZIP, "application/zip")).toBe(false);
    expect(fileBytesContradictType(ZIP, "application/x-zip-compressed")).toBe(false);
    // An epub IS a zip; the signature cannot distinguish them and must not try.
    expect(fileBytesContradictType(ZIP, "application/epub+zip")).toBe(false);
    expect(fileBytesContradictType(PDF, "application/pdf")).toBe(false);
    expect(fileBytesContradictType(WAV, "audio/wav")).toBe(false);
    expect(fileBytesContradictType(WAV, "audio/x-wav")).toBe(false);
    expect(fileBytesContradictType(MP4, "video/mp4")).toBe(false);
    expect(fileBytesContradictType(TEXT, "text/plain")).toBe(false);
  });

  it("catches binary content hiding under text/plain", () => {
    // The case that matters: a payload stored under the one type nobody
    // scrutinises, because plain text is assumed inert.
    expect(fileBytesContradictType(ZIP, "text/plain")).toBe(true);
    expect(fileBytesContradictType(PDF, "text/plain")).toBe(true);
    expect(fileBytesContradictType(MP4, "text/plain")).toBe(true);
  });

  it("catches a declared type the container flatly contradicts", () => {
    expect(fileBytesContradictType(PDF, "application/zip")).toBe(true);
    expect(fileBytesContradictType(ZIP, "application/pdf")).toBe(true);
    expect(fileBytesContradictType(MP4, "audio/mpeg")).toBe(true);
  });

  it("refuses an unrecognised container claiming a binary type", () => {
    // Nothing matched, so the file is not the zip it says it is.
    expect(fileBytesContradictType(TEXT, "application/zip")).toBe(true);
    expect(fileBytesContradictType(TEXT, "application/pdf")).toBe(true);
  });
});

describe("peekStream", () => {
  const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });

  const drain = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
    const out: number[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(...value);
    }
    return new Uint8Array(out);
  };

  it("returns the head without losing a single byte from the body", async () => {
    // This is the property the whole design rests on: the route sends an
    // explicit Content-Length to R2, so a dropped or duplicated byte fails the
    // upload outright.
    const original = new Uint8Array([...Array(100).keys()]);
    const { head, body } = await peekStream(streamOf([original]), 12);
    expect(Array.from(head)).toEqual(Array.from(original.subarray(0, 12)));
    expect(Array.from(await drain(body))).toEqual(Array.from(original));
  });

  it("reassembles a head that spans several chunks", async () => {
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6, 7]),
      new Uint8Array([8, 9, 10, 11, 12, 13]),
    ];
    const { head, body } = await peekStream(streamOf(chunks), 12);
    expect(Array.from(head)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Array.from(await drain(body))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("returns a short head when the stream ends early, and still replays it", async () => {
    // A caller must be able to tell "too few bytes to judge" from "judged fine".
    const { head, body } = await peekStream(streamOf([new Uint8Array([1, 2, 3])]), 12);
    expect(head.byteLength).toBe(3);
    expect(Array.from(await drain(body))).toEqual([1, 2, 3]);
  });

  it("handles an empty stream", async () => {
    const { head, body } = await peekStream(streamOf([]), 12);
    expect(head.byteLength).toBe(0);
    expect((await drain(body)).byteLength).toBe(0);
  });
});
