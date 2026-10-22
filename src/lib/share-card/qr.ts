import { encode } from "uqr";

/**
 * A QR code as ONE svg path of unit squares, `size` modules across, so the
 * caller draws it in whatever ink its surface uses (`fill="currentColor"`)
 * rather than the black-on-white renderSVG bakes in. Medium error correction:
 * a printed or screenshotted card still scans with a glare spot on it. No
 * quiet zone: the card around it supplies one.
 */
export function qrPath(text: string): { size: number; path: string } {
  const { size, data } = encode(text, { ecc: "M", border: 0 });
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y][x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}
