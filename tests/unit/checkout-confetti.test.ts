/**
 * The thank-you page's confetti engine (components/checkout/confetti.ts):
 * the same burst on every play, over in a few seconds, launched to peak where
 * it was aimed, and in colours that are the shop's and that show on its page.
 */
import { describe, expect, it } from "vitest";
import {
  climbSpeed,
  confettiPalette,
  createConfetti,
  pieceOpacity,
  seededRandom,
  stepConfetti,
} from "@/components/checkout/confetti";
import { contrastRatio, hexToHsv } from "@/lib/format/color";

const PHONE = { width: 390, height: 844 };
const ORIGIN = { x: 195, y: 120 };
const COLORS = ["#1f4d3a", "#e8b44c", "#7cc6fe"];

/** Run to the end at 60fps, reporting how many frames that took. */
function runOut(pieces: ReturnType<typeof createConfetti>, height: number, limit = 1000): number {
  let frames = 0;
  while (stepConfetti(pieces, 1, height) && frames < limit) frames++;
  return frames;
}

describe("the confetti moves", () => {
  it("is the same burst on every play", () => {
    const a = createConfetti({ ...PHONE, origin: ORIGIN, colors: COLORS });
    const b = createConfetti({ ...PHONE, origin: ORIGIN, colors: COLORS });
    for (let i = 0; i < 60; i++) {
      stepConfetti(a, 1, PHONE.height);
      stepConfetti(b, 1.0, PHONE.height);
    }
    expect(a).toEqual(b);
    expect(seededRandom(7)()).toBe(seededRandom(7)());
  });

  it("is over in a few seconds, and every piece has faded by then", () => {
    const pieces = createConfetti({ ...PHONE, origin: ORIGIN, colors: COLORS });
    const frames = runOut(pieces, PHONE.height);
    expect(frames).toBeGreaterThan(120);
    // Under five seconds at 60fps, delays included.
    expect(frames).toBeLessThan(300);
    for (const piece of pieces) {
      expect(piece.age >= piece.life || piece.y > PHONE.height).toBe(true);
    }
  });

  it("fills a wide screen with more than a narrow one, within bounds", () => {
    const phone = createConfetti({ ...PHONE, origin: ORIGIN, colors: COLORS }).length;
    const desktop = createConfetti({ width: 1440, height: 900, origin: ORIGIN, colors: COLORS }).length;
    expect(desktop).toBeGreaterThan(phone);
    expect(desktop).toBeLessThan(400);
  });

  it("launches each piece to peak where it was aimed, air drag and all", () => {
    for (const drag of [0.965, 0.975, 0.982]) {
      for (const rise of [200, 500, 760]) {
        const speed = climbSpeed(rise, drag);
        let vy = -speed;
        let climbed = 0;
        while (vy < 0) {
          climbed -= vy;
          vy = vy * drag + 0.2;
        }
        expect(Math.abs(climbed - rise), `${drag} ${rise}`).toBeLessThan(1);
      }
    }
  });

  it("keeps the volleys on a phone: none flies far off either side", () => {
    const pieces = createConfetti({ ...PHONE, origin: ORIGIN, colors: COLORS });
    let widest = 0;
    for (let i = 0; i < 200; i++) {
      stepConfetti(pieces, 1, PHONE.height);
      for (const piece of pieces) {
        if (piece.delay > 0 || pieceOpacity(piece) === 0) continue;
        widest = Math.max(widest, -piece.x, piece.x - PHONE.width);
      }
    }
    expect(widest).toBeLessThan(PHONE.width * 0.25);
  });

  it("fades a piece out over the end of its life, never pops it", () => {
    const [piece] = createConfetti({ ...PHONE, origin: ORIGIN, colors: COLORS });
    expect(pieceOpacity({ ...piece, age: 0 })).toBe(1);
    expect(pieceOpacity({ ...piece, age: piece.life * 0.9 })).toBeGreaterThan(0);
    expect(pieceOpacity({ ...piece, age: piece.life * 0.9 })).toBeLessThan(1);
    expect(pieceOpacity({ ...piece, age: piece.life })).toBe(0);
  });
});

describe("the confetti's colours", () => {
  it("are the shop's hue, its neighbours and a gold, for a brand with a colour", () => {
    const palette = confettiPalette({ accent: "#1f4d3a", button: "#1f4d3a", surface: "#f6f1e7" });
    expect(palette).toContain("#1f4d3a");
    expect(palette.length).toBeGreaterThanOrEqual(4);
    const hues = palette.map((hex) => hexToHsv(hex)!.h);
    expect(new Set(hues.map((h) => Math.round(h / 20))).size).toBeGreaterThan(2);
  });

  it("are metallics beside the brand's own dark, for a black-and-white brand", () => {
    const palette = confettiPalette({ accent: "#0a0a0a", button: "#0a0a0a", surface: "#ffffff" });
    expect(palette).toContain("#0a0a0a");
    // Gold, champagne, silver: nothing louder than a metal.
    for (const hex of palette) expect(hexToHsv(hex)!.s).toBeLessThan(75);
  });

  it("never include a colour that vanishes on the page, and never fewer than three", () => {
    for (const surface of ["#ffffff", "#0a0a0a", "#1f2a24", "#e8b44c"]) {
      for (const accent of ["#0a0a0a", "#1f4d3a", "#ffffff", "#e8b44c"]) {
        const palette = confettiPalette({ accent, button: accent, surface });
        expect(palette.length, `${accent} on ${surface}`).toBeGreaterThanOrEqual(3);
        for (const hex of palette) expect(contrastRatio(hex, surface), `${hex} on ${surface}`).toBeGreaterThanOrEqual(1.3);
      }
    }
  });
});
