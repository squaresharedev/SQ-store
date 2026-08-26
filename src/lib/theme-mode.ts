/**
 * Light/dark resolution for Square Share.
 *
 * The order is: an explicit preference saved for this account, then the
 * operating system. Square Share has no stored theme preference yet, so today
 * every visitor lands on their system setting — but the seam is here rather
 * than assumed, so wiring the real thing later is one change in one file:
 *
 *   1. Read the saved preference server-side (cookie or profile row) and render
 *      `data-theme` on <html> in the root layout. The script below leaves an
 *      explicit value alone, so nothing here needs touching.
 *   2. Mirror it into localStorage under THEME_STORAGE_KEY on save, so the
 *      pre-paint script can honour it before any JS has run.
 *
 * Resolution happens in JS rather than a `@media (prefers-color-scheme: dark)`
 * block on purpose: a media query cannot be overridden by a saved preference,
 * and duplicating the whole dark palette into one would leave two copies of
 * every token to keep in step. Resolving to a single attribute means the
 * palette is declared exactly once (see `.dark, [data-theme="dark"] ...` in
 * globals.css).
 *
 * WHAT ACTUALLY GOES DARK is a separate question from what the theme resolves
 * to. `data-theme` lands on <html> for every page, but only surfaces opting in
 * with `.theme-surface` read it. The dashboard has only ever been designed and
 * reviewed in light mode, so flipping it wholesale for anyone whose OS is dark
 * would change every screen in the product sight unseen. Today the error
 * screens opt in; when the dashboard is ready, `.theme-surface` comes out of
 * that one selector and the whole app follows.
 */

/** What a person can choose. "system" is the default and follows the OS. */
export type ThemePreference = "light" | "dark" | "system";

/** What a preference resolves to. Only ever these two on the page. */
export type Theme = "light" | "dark";

/**
 * Where a saved preference is mirrored for the pre-paint script. Nothing writes
 * this yet; the reader is deliberately in place first, so that when something
 * does, no theme flash is introduced along with it.
 */
export const THEME_STORAGE_KEY = "sq-theme";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs synchronously in <head>, so the palette is settled BEFORE first paint.
 * Without it a system-dark visitor gets a white flash on a page that is about
 * to be black, which on an error screen is the worst possible first impression.
 *
 * Vanilla, and mounted once in the root layout rather than inside a component,
 * for two reasons. It has to run before React exists to beat the paint. And an
 * inline <script> rendered by a component is silently dead whenever React
 * renders that component on the CLIENT — which is exactly what happens to an
 * error boundary, the surface that most needs this to work.
 *
 * Also subscribes: the OS theme flipping, or another tab saving a preference,
 * re-resolves without React being involved at all.
 */
export const THEME_BOOTSTRAP = `(function(){
var K=${JSON.stringify(THEME_STORAGE_KEY)},m;
function r(){
var p=null;try{p=localStorage.getItem(K)}catch(_){}
if(p==="light"||p==="dark")return p;
return m.matches?"dark":"light";
}
function a(){try{document.documentElement.dataset.theme=r()}catch(_){}}
try{
m=matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)});
if(!document.documentElement.dataset.theme)a();
m.addEventListener("change",a);
addEventListener("storage",function(e){if(!e.key||e.key===K)a()});
}catch(_){}
})()`;
