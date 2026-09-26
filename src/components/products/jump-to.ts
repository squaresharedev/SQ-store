/**
 * Scrolls an element into view and records it in the URL, WITHOUT the
 * `popstate` a plain `#hash` click fires. Chrome, Safari and Firefox all fire
 * one for a same-document jump, and the product form's unsaved-changes guard
 * reads `popstate` as the Back button, so every in-page link on that form
 * scrolls through here instead (see FormSectionNav).
 */
export function jumpToElement(domId: string): void {
  document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", `#${domId}`);
}
