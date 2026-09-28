/** Escapes text for an HTML text node or a quoted attribute, for the rare
 *  surface that has to write a whole document as a string (app/offline). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
