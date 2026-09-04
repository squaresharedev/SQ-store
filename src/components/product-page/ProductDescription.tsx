"use client";

import { useState } from "react";
import { paragraphs } from "./product-page-maps";

/**
 * The product's description where a buyer actually looks for it: under the
 * title, above the price, beside the photos.
 *
 * IT CLAMPS. The whole point of putting the description here is that the price
 * and the button stay on the first screen, and a seller who wrote six
 * paragraphs would otherwise push both below the fold and undo the change. So
 * a long description collapses to a few lines with a "Read more", exactly the
 * bargain every marketplace makes in this slot.
 *
 * The decision is made from the TEXT LENGTH, not by measuring the rendered box.
 * Measuring would mean a layout read after paint, which means the page renders
 * once unclamped and then snaps, and it would differ between the public page
 * and the editor's narrower artboard. A character count is stable, identical on
 * the server and the client, and only ever wrong at the margin (a description
 * of roughly clamp length shows a toggle that reveals one more line).
 *
 * Like every seller string on this page, the text is a React text node and
 * nothing else. There is no markup path here.
 */

/** Roughly what the collapsed box (`line-clamp-5`) holds in this column. Past
 *  it, offer the toggle. Five lines is enough to be a real blurb and short
 *  enough to leave the price and the button above the fold on a phone. */
const CLAMP_CHARS = 260;

export function ProductDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const blocks = paragraphs(text);
  if (blocks.length === 0) return null;

  const clampable = text.length > CLAMP_CHARS;

  return (
    <div className="flex flex-col items-start gap-1.5" data-product-description="">
      {expanded || !clampable ? (
        <div className="flex flex-col gap-3 text-sm leading-relaxed">
          {blocks.map((block, index) => (
            <p key={index} className="whitespace-pre-line">
              {block}
            </p>
          ))}
        </div>
      ) : (
        // One block while collapsed, paragraphs joined by a single newline:
        // line-clamp counts lines in one box, and blank lines between
        // paragraphs would spend the budget on whitespace.
        <p className="line-clamp-5 whitespace-pre-line text-sm leading-relaxed">
          {blocks.join("\n")}
        </p>
      )}
      {clampable && (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
          className="text-sm font-medium underline underline-offset-2 opacity-80 transition-opacity duration-base ease-standard hover:opacity-100 motion-reduce:transition-none"
          data-product-description-toggle=""
        >
          {expanded ? "Read less" : "Read more"}
        </button>
      )}
    </div>
  );
}
