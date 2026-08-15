"use client";

import { useEffect } from "react";
import type { StorefrontCustomFont } from "@/types/storefront";
import { customFontFamily, isSafeFontUrl } from "@/lib/theme/storefront-fonts";

/**
 * Registers a seller's uploaded typeface with the document, so anything set in
 * its family (see fontPresentation) renders in it. Draws nothing.
 *
 * DELIBERATELY LAZY. The face is added to `document.fonts` but never `.load()`ed
 * : the browser fetches the bytes only if something on the page actually paints
 * in that family, and not at all when the storefront's font is one of the
 * built-ins. That is what keeps an uploaded font off the critical path: no
 * preload, no blocking request, nothing downloaded for a seller who uploaded a
 * font once and then switched back.
 *
 * The URL is signed server-side (or a local object URL for a file just picked)
 * and re-gated here before it goes anywhere near a font source.
 */
export function CustomFontFace({
  customFont,
  url,
}: {
  customFont: StorefrontCustomFont | undefined;
  /** Presigned R2 GET, or a blob: URL for an in-session upload. */
  url: string | null;
}) {
  const family = customFont ? customFontFamily(customFont.key) : null;
  const safeUrl = url && isSafeFontUrl(url) ? url : null;

  useEffect(() => {
    if (!family || !safeUrl) return;
    // Older browsers without the CSS Font Loading API simply keep the fallback.
    if (typeof FontFace === "undefined" || !document.fonts) return;

    const face = new FontFace(family, `url("${safeUrl}")`, { display: "swap" });
    document.fonts.add(face);
    return () => {
      document.fonts.delete(face);
    };
  }, [family, safeUrl]);

  return null;
}
