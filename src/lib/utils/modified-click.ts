import type { MouseEvent } from "react";

/**
 * A click the browser should keep: a new tab, a new window, a download, a
 * middle click. A link that handles plain clicks itself (opening a panel in
 * place, navigating inside a transition) must let these through untouched, or
 * "open in new tab" stops working.
 */
export function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
