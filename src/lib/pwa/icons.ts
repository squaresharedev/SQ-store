/**
 * The icons the web app manifest offers, each rendered from the SQ mark by
 * scripts/generate-app-icons.ts into public/ at `src`. The script reads this
 * list, so adding an entry here and re-running it is the whole change.
 *
 * Both purposes are needed. "any" is drawn as a rounded tile and used as-is by
 * desktop installs and the install dialog. "maskable" is full-bleed with the
 * mark inside the central safe zone, because Android and ChromeOS crop it to
 * their own shape (circle, squircle) and would otherwise shave the mark.
 */
export const MANIFEST_ICONS = [
  { src: "/icons/icon-192.png", size: 192, purpose: "any" },
  { src: "/icons/icon-512.png", size: 512, purpose: "any" },
  { src: "/icons/icon-maskable-192.png", size: 192, purpose: "maskable" },
  { src: "/icons/icon-maskable-512.png", size: 512, purpose: "maskable" },
] as const;

export type ManifestIconPurpose = (typeof MANIFEST_ICONS)[number]["purpose"];
