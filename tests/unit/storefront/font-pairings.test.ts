import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_STOREFRONT_CONFIG, FONT_PAIRINGS, type StorefrontTheme } from "@/types/storefront";
import { FONT_ROLE_VARS } from "@/lib/theme/font-roles";
import {
  FONT_PAIRING_FACES,
  PAIRING_FACES,
  PAIRING_FACE_VARS,
  fontPairingStyle,
  headerLinePairingFont,
  isFontPairing,
  pairingFaceStack,
} from "@/lib/theme/font-pairings";
import { typographyMenuHint } from "@/lib/theme/font-pairing-labels";
import { boardFontPresentation, pairingFontPresentation } from "@/lib/theme/font-pairing-presentation";
import { fontPresentation } from "@/lib/theme/storefront-fonts";

// THE FONT PAIRINGS (lib/theme/font-pairings, app/fonts/pairing-faces): which
// faces each one is, how a board names them, and the promises about the files
// themselves (self-hosted, licensed, nothing preloaded).

const FONTS = path.resolve(__dirname, "../../../src/app/fonts");
const facesSource = readFileSync(path.join(FONTS, "pairing-faces.ts"), "utf8");
const licenses = readFileSync(path.join(FONTS, "LICENSES.md"), "utf8");
const layoutSource = readFileSync(path.resolve(FONTS, "../layout.tsx"), "utf8");

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({ ...DEFAULT_STOREFRONT_CONFIG.theme, ...over });

describe("the pairing table", () => {
  it("gives every pairing a heading face and a body face that exist", () => {
    for (const pairing of FONT_PAIRINGS) {
      expect(PAIRING_FACES).toContain(FONT_PAIRING_FACES[pairing].heading);
      expect(PAIRING_FACES).toContain(FONT_PAIRING_FACES[pairing].body);
    }
  });

  it("names exactly the faces the brief intends", () => {
    expect(FONT_PAIRING_FACES).toEqual({
      editorial: { heading: "fraunces", body: "inter" },
      classic: { heading: "playfair", body: "sourceSans" },
      modern: { heading: "spaceGrotesk", body: "inter" },
      soft: { heading: "dmSerif", body: "dmSans" },
      studio: { heading: "instrumentSerif", body: "manrope" },
    });
  });

  it("knows a pairing from anything else", () => {
    expect(isFontPairing("editorial")).toBe(true);
    expect(isFontPairing("comic")).toBe(false);
    expect(isFontPairing(undefined)).toBe(false);
  });
});

describe("the faces' files", () => {
  // Every variable the table points at is declared by the faces module, or
  // (Inter, Space Grotesk's Latin halves) by the root layout.
  it("declares every variable the table names", () => {
    for (const face of PAIRING_FACES) {
      const { latin, ext } = PAIRING_FACE_VARS[face];
      expect(facesSource, ext).toContain(`variable: "${ext}"`);
      const declaredBy = latin.startsWith("--font-pair-") ? facesSource : layoutSource;
      expect(declaredBy, latin).toContain(`variable: "${latin}"`);
    }
  });

  it("preloads nothing: a face is fetched only when words on screen use it", () => {
    const calls = facesSource.split("localFont({").slice(1);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("preload: false");
  });

  it("limits every Latin Extended face to Latin Extended characters", () => {
    const extCalls = facesSource.split("localFont({").slice(1).filter((call) => call.includes('-ext"'));
    expect(extCalls).toHaveLength(PAIRING_FACES.length);
    for (const call of extCalls) {
      expect(call).toContain('prop: "unicode-range"');
      // No fallback face of its own: one would answer for every character
      // ahead of the Latin face.
      expect(call).toContain("adjustFontFallback: false");
    }
  });

  it("ships every referenced file, licensed and listed with its checksum", () => {
    const files = [...facesSource.matchAll(/path: "\.\/(pairings\/[^"]+\.woff2)"|src: "\.\/(pairings\/[^"]+\.woff2)"/g)].map(
      (match) => match[1] ?? match[2],
    );
    expect(files.length).toBeGreaterThanOrEqual(PAIRING_FACES.length * 2 - 2);
    for (const file of files) {
      const full = path.join(FONTS, file);
      expect(existsSync(full), file).toBe(true);
      const sha = createHash("sha256").update(readFileSync(full)).digest("hex");
      expect(licenses, file).toContain(`${sha}  ${path.basename(file)}`);
    }
    expect(licenses).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});

describe("how a board names a pairing", () => {
  it("puts the Latin Extended face first, then Latin, then a generic family", () => {
    expect(pairingFaceStack("fraunces")).toBe(
      "var(--font-pair-fraunces-ext), var(--font-pair-fraunces), Georgia, ui-serif, serif",
    );
    expect(pairingFaceStack("inter")).toBe("var(--font-pair-inter-ext), var(--font-inter), ui-sans-serif, system-ui, sans-serif");
  });

  it("sets both role variables and the body face as the board's own font", () => {
    const style = fontPairingStyle("soft") as Record<string, string>;
    expect(style[FONT_ROLE_VARS.heading]).toBe(pairingFaceStack("dmSerif"));
    expect(style[FONT_ROLE_VARS.body]).toBe(pairingFaceStack("dmSans"));
    expect(style.fontFamily).toBe(`var(${FONT_ROLE_VARS.body})`);
  });

  it("without a pairing is exactly the single font, as before", () => {
    const serif = theme({ font: "serif" });
    expect(pairingFontPresentation(serif)).toBeUndefined();
    expect(boardFontPresentation(serif)).toEqual(fontPresentation("serif"));
    expect(boardFontPresentation(theme({ font: "custom" }))).toEqual(fontPresentation("custom"));
  });

  it("with a pairing wins over the font, and declares only its own two faces", () => {
    const shown = boardFontPresentation(theme({ font: "serif", fontPairing: "editorial" }));
    // The test setup names each next/font class after its variable.
    expect(shown.className).toContain("__variable--font-pair-fraunces");
    expect(shown.className).toContain("__variable--font-pair-fraunces-ext");
    expect(shown.className).toContain("__variable--font-pair-inter-ext");
    expect(shown.className).not.toContain("playfair");
    expect(shown.className).not.toContain("font-serif");
    expect(shown.style).toEqual(fontPairingStyle("editorial"));
  });

  it("sets the store name in the headline face, and only the store name", () => {
    const paired = theme({ fontPairing: "classic" });
    expect(headerLinePairingFont(paired, "name", undefined)?.style).toEqual({
      fontFamily: `var(${FONT_ROLE_VARS.heading}, inherit)`,
    });
    expect(headerLinePairingFont(paired, "bio", undefined)).toBeUndefined();
    expect(headerLinePairingFont(paired, "name", "hand")).toBeUndefined();
    expect(headerLinePairingFont(theme(), "name", undefined)).toBeUndefined();
  });

  it("names the pairing in the Typography menu, and leaves the font's name otherwise", () => {
    const t = (key: string) => `t:${key}`;
    expect(typographyMenuHint(theme({ fontPairing: "studio" }), t)).toBe("t:EditorType.panel.pairings.studio.name");
    expect(typographyMenuHint(theme(), t)).toBeUndefined();
  });
});
