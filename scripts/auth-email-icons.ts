// Line icons for the auth emails. Email clients (Gmail above all) drop inline
// SVG, so `auth-emails.ts assets` renders these to PNG and uploads them to the
// public `email-assets` Storage bucket, which the templates reference by URL.
// Drawn on a 24 grid with square caps and mitred joins to match the SQ mark.

/** Hero tile icons, keyed by name; each value is the inner SVG markup. */
export const HERO_ICONS: Record<string, string> = {
  mail: `<rect x="3" y="5" width="18" height="14"/><path d="M3 7l9 6 9-6"/>`,
  "user-plus": `<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M19 8v6M16 11h6"/>`,
  "log-in": `<path d="M14 4h6v16h-6"/><path d="M3 12h11M10 7l5 5-5 5"/>`,
  key: `<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>`,
  shield: `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 5-5"/>`,
  lock: `<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  phone: `<rect x="7" y="2" width="10" height="20"/><path d="M11 18h2"/>`,
  "shield-plus": `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 9v6M9 12h6"/>`,
  "shield-minus": `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12h6"/>`,
  link: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
  unlink: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M4 4l16 16"/>`,
};

/** The arrow on every call-to-action button (white, transparent background). */
export const ARROW_ICON = `<path d="M4 12h15M13 6l6 6-6 6"/>`;

export const svg = (inner: string, stroke: string, size: number, bg?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${
    bg ? `<rect x="-6" y="-6" width="36" height="36" fill="${bg}"/>` : ""
  }<g transform="${bg ? "translate(12 12) scale(0.62) translate(-12 -12)" : ""}" fill="none" stroke="${stroke}" stroke-width="${bg ? 2.4 : 2.2}" stroke-linecap="square" stroke-linejoin="miter">${inner}</g></svg>`;
