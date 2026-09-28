/**
 * The brand, in the places the app names or draws itself OUTSIDE its own UI:
 * the tab title, the install prompt, the operating system's app list, the app
 * icons and the offline page. Pure constants with no imports, because
 * scripts/generate-app-icons.ts reads this file straight from Node.
 */

/** The product's name as the browser and the OS show it. */
export const BRAND_NAME = "Square Share";

/** Every page title's shape: the page's own title, then the brand. */
export const BRAND_TITLE_TEMPLATE = `%s | ${BRAND_NAME}`;

/**
 * Mirrors of the two globals.css tokens the brand is drawn in, for surfaces
 * that cannot read CSS variables: the manifest, the icons, the offline page
 * and the browser's theme colour. Hex, not the tokens' oklch, because the
 * manifest and the icon renderer want plain sRGB.
 */
export const BRAND_SURFACE = "#ffffff"; // --background
export const BRAND_INK = "#0a0a0a"; // --foreground

/**
 * THE SQ MARK as geometry: an L, and a corner bracket above its right arm.
 * Measured off public/img/logo.png (a 1080 canvas, where the mark's box runs
 * from 225,228 to 855,852), so the icons drawn from it match the logo edge for
 * edge. The viewBox is cropped to the mark itself; callers scale and centre it.
 */
export const BRAND_MARK = {
  width: 630,
  height: 624,
  path: "M0 84H270V354H540V624H0Z M360 0H630V270H547V83H360Z",
} as const;
