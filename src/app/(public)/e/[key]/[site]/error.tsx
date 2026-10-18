"use client";

/**
 * The embed frame's error boundary: NOTHING, for the same reason its not-found
 * is empty (see not-found.tsx beside this file). A frame that failed draws
 * nothing and stays collapsed; it does not put an error screen, or a retry
 * button, inside a seller's website.
 */
export default function EmbedFrameError() {
  return null;
}
