"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * What the screen shows while the UI changes language: the page dims under a
 * light dark veil, and one character in the middle cycles through the world's
 * scripts, floating free with nothing behind it.
 * The same for every language, on purpose: it says "translating", not which
 * language is coming.
 *
 * Pure presentation. LocaleSwitchProvider (src/i18n) decides when it shows and
 * when it leaves. The motion is CSS (globals.css, "Language switch overlay").
 */

/** One character per script, in an order that alternates shapes so each change reads. */
const GLYPHS = ["A", "文", "Ж", "あ", "ع", "Ω", "अ", "한", "ß", "א", "Č", "ก"];

/** How long each character holds before the next one rises in. */
const TICK_MS = 450;

/** Shortest time the overlay shows, so a fast switch still reads as one moment, not a flash. */
export const MIN_SHOW_MS = 700;

/** Matches .language-overlay[data-leaving] in globals.css (duration-base). */
export const EXIT_MS = 180;

export function LanguageSwitchOverlay({
  leaving,
  announcement,
}: {
  leaving: boolean;
  /** What a screen reader hears, already in the reader's (current) language. */
  announcement: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => i + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const current = GLYPHS[index % GLYPHS.length];
  const previous = index > 0 ? GLYPHS[(index - 1) % GLYPHS.length] : null;

  return createPortal(
    <div
      className="language-overlay fixed inset-0 z-[80] grid place-items-center bg-black/35 backdrop-blur-[2px]"
      data-leaving={leaving ? "" : undefined}
      data-language-switch-overlay=""
    >
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div
        aria-hidden="true"
        className="language-glyphs relative size-24"
      >
        {previous && (
          <span
            key={`out-${index}`}
            className="language-glyph-out absolute inset-0 grid place-items-center font-display text-6xl font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.3),0_4px_24px_rgb(0_0_0/0.4)]"
          >
            {previous}
          </span>
        )}
        <span
          key={`in-${index}`}
          className="language-glyph-in absolute inset-0 grid place-items-center font-display text-6xl font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.3),0_4px_24px_rgb(0_0_0/0.4)]"
        >
          {current}
        </span>
      </div>
    </div>,
    document.body,
  );
}
