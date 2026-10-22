/**
 * iPhone photo formats (HEIC and HEIF). Browsers cannot draw them, so the app
 * does not take them as product photos (lib/uploads/sniff.ts accepts JPEG,
 * PNG, WebP, GIF and AVIF). A seller meets one by dragging a photo off a Mac
 * or out of the iPhone's Files app; picking it from the phone's photo library
 * instead hands over a JPEG, which is what the message for it says to do.
 * Client-safe: a type and a file name, nothing read from the file.
 */
const HEIC_TYPES: readonly string[] = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
];

/** Some systems hand the file over with no type at all: the name decides. */
const HEIC_EXTENSION = /\.hei[cf]$/i;

export function isHeicPhoto(file: { type: string; name: string }): boolean {
  return HEIC_TYPES.includes(file.type.toLowerCase()) || HEIC_EXTENSION.test(file.name);
}
