"use client";

import { useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";

/** The parts of an add-on row the measurement reads, by data attribute, so
 *  the row needs one ref rather than five. */
export const ADD_ON_ROW_PARTS = {
  photo: "data-product-add-on-photo",
  words: "data-product-add-on-words",
  pickers: "data-product-add-on-pickers",
  button: "data-product-add-on-toggle",
  details: "data-product-add-on-details",
} as const;

const part = (row: HTMLElement, name: keyof typeof ADD_ON_ROW_PARTS) =>
  row.querySelector<HTMLElement>(`[${ADD_ON_ROW_PARTS[name]}]`);

const gapOf = (element: HTMLElement) => parseFloat(getComputedStyle(element).columnGap) || 0;

/**
 * Whether a row's version pickers fit BESIDE its Add button with the product's
 * name and price still whole. Measured, because it depends on the names (the
 * product's, the chosen version's) and on the box the page is drawn in: the
 * same card fits them in a desktop buy box and not on a phone.
 *
 * Every width read here is the same in either arrangement (the words' and the
 * pickers' natural widths, the button's own), so moving the pickers can never
 * change the answer that moved them: no flicker back and forth.
 */
function fitsBeside(row: HTMLElement): boolean {
  const photo = part(row, "photo");
  const words = part(row, "words");
  const pickers = part(row, "pickers");
  const button = part(row, "button");
  const details = part(row, "details");
  if (!photo || !words || !pickers || !button || !details) return false;
  const style = getComputedStyle(row);
  const room = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  // A truncated line still reports its whole width as scrollWidth.
  const wordsWidth = Math.max(0, ...Array.from(words.children, (line) => line.scrollWidth));
  const pickerWidths = Array.from(pickers.children, (picker) => (picker as HTMLElement).offsetWidth);
  const pickersWidth =
    pickerWidths.reduce((sum, width) => sum + width, 0) + gapOf(pickers) * Math.max(0, pickerWidths.length - 1);
  const needed =
    photo.offsetWidth + gapOf(details) + wordsWidth + gapOf(row) + pickersWidth + gapOf(row) + button.offsetWidth;
  // A pixel of slack: widths are rounded, and a name cut by half a pixel is cut.
  return needed + 1 <= room;
}

/**
 * The row's ref and whether its pickers go beside the button. `key` names what
 * changes the pickers' widths without resizing the row (the chosen versions),
 * so a new choice measures again. Off (`enabled` false) answers "no".
 */
export function usePickersBeside(enabled: boolean, key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [beside, setBeside] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const row = ref.current;
    if (!enabled || !row) return;
    let live = true;
    const measure = () => {
      if (live) setBeside(fitsBeside(row));
    };
    measure();
    // A seller's own font arrives late and changes every width it sets.
    void document.fonts?.ready.then(measure);
    if (typeof ResizeObserver === "undefined") return () => void (live = false);
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [enabled, key]);

  return { ref, beside: enabled && beside };
}
