/**
 * Renders every app icon from the SQ mark's geometry (src/lib/brand.ts), so a
 * logo change is one edit and one run:
 *
 *   node scripts/generate-app-icons.ts
 *
 * Writes the manifest icons listed in src/lib/pwa/icons.ts into public/, plus
 * the two icons Next.js picks up by file name: app/apple-icon.png (the iOS
 * home screen) and app/favicon.ico. Drawn from SVG by headless Chromium, like
 * the email icons in auth-emails.ts, and committed: nothing renders at build
 * or request time.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, type Page } from "playwright";
import { BRAND_INK, BRAND_MARK, BRAND_SURFACE } from "../src/lib/brand.ts";
import { MANIFEST_ICONS, type ManifestIconPurpose } from "../src/lib/pwa/icons.ts";

const ROOT = join(import.meta.dirname, "..");

type Look = {
  /** "tile": a square on transparent corners, shown as-is by desktops
   *  and tabs. "bleed": square to the edges, for platforms that crop the icon
   *  to their own shape (Android, iOS). */
  background: "tile" | "bleed";
  /** The mark's width as a share of the icon's. */
  markScale: number;
  /** Corner radius of a "tile" background, as a share of its side. Defaults to TILE_RADIUS. */
  radius?: number;
};

/** The logo's own proportion: the mark spans 630 of its 1080 canvas. */
const LOGO_SCALE = BRAND_MARK.width / 1080;

const LOOKS = {
  any: { background: "tile", markScale: LOGO_SCALE },
  // Keeps the mark's corners well inside the maskable safe zone, a centred
  // circle 80% across (its half-diagonal lands at 32% of the side).
  maskable: { background: "bleed", markScale: 0.46 },
  // iOS rounds the corners itself, and fills anything transparent with black.
  touch: { background: "bleed", markScale: LOGO_SCALE },
  // A bigger mark, so it still reads at 16px in a browser tab. Sharp
  // corners: a rounded tile disappears into the tab's own curve at that size.
  favicon: { background: "tile", markScale: 0.68, radius: 0 },
} satisfies Record<ManifestIconPurpose | "touch" | "favicon", Look>;

/** Corner radius of the "tile" background, as a share of its side. */
const TILE_RADIUS = 0.225;

const FAVICON_SIZES = [16, 32, 48];
const TOUCH_ICON_SIZE = 180;

function iconSvg(size: number, look: Look): string {
  const scale = (size * look.markScale) / BRAND_MARK.width;
  const x = (size - BRAND_MARK.width * scale) / 2;
  const y = (size - BRAND_MARK.height * scale) / 2;
  const radius = look.background === "tile" ? size * (look.radius ?? TILE_RADIUS) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND_SURFACE}"/>
    <path d="${BRAND_MARK.path}" fill="${BRAND_INK}" shape-rendering="crispEdges" transform="translate(${x} ${y}) scale(${scale})"/>
  </svg>`;
}

// Draws onto a <canvas> and reads it back via toDataURL rather than
// page.screenshot(): Chromium's screenshot encoder drops the alpha channel
// for a fully-opaque capture (e.g. a sharp-cornered favicon tile), and
// Next.js's ICO decoder rejects a favicon.ico frame that isn't RGBA. Canvas
// PNG encoding always keeps the alpha channel, opaque or not.
async function render(page: Page, size: number, look: Look): Promise<Buffer> {
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(iconSvg(size, look)).toString("base64")}`;
  await page.setContent(`<canvas id="c" width="${size}" height="${size}"></canvas>`);
  const dataUrl = await page.evaluate(
    async ({ svgDataUrl, size }) => {
      const img = new Image();
      img.src = svgDataUrl;
      await img.decode();
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      canvas.getContext("2d")!.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL("image/png");
    },
    { svgDataUrl, size },
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Packs PNGs into one .ico (PNG-in-ICO, which every current browser reads). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ size, png }, i) => {
    const entry = i * 16;
    directory.writeUInt8(size % 256, entry); // 0 means 256
    directory.writeUInt8(size % 256, entry + 1);
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...images.map(({ png }) => png)]);
}

function write(relativePath: string, data: Buffer): void {
  const file = join(ROOT, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`wrote ${relativePath} (${data.length} bytes)`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });

  for (const { src, size, purpose } of MANIFEST_ICONS) {
    write(join("public", src), await render(page, size, LOOKS[purpose]));
  }

  write(
    "src/app/apple-icon.png",
    await render(page, TOUCH_ICON_SIZE, LOOKS.touch),
  );

  const favicons = [];
  for (const size of FAVICON_SIZES) {
    favicons.push({ size, png: await render(page, size, LOOKS.favicon) });
  }
  write("src/app/favicon.ico", ico(favicons));
} finally {
  await browser.close();
}
