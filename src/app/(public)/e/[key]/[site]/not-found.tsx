/**
 * The embed frame's not-found: NOTHING, on purpose.
 *
 * This document is drawn inside a seller's website. The buyer pages' own 404
 * (app/(public)/not-found.tsx) is a screen-tall notice with a way onward, which
 * in a frame would be a stranger's error message in the middle of someone's
 * page, addressed to a visitor who can do nothing about it. An empty document
 * never reports a height (see useEmbedFrameReport), so the loader leaves the
 * frame collapsed and the seller's page looks as if the embed were not there.
 */
export default function EmbedFrameNotFound() {
  return null;
}
